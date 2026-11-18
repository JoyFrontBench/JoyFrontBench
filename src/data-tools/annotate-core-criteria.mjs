#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_EVAL_MODEL,
  dataRoot as promptRoot,
  loadEnvironment,
  repositoryRoot as frontRoot,
  resolveApiConfig,
} from '../evaluation/scripts/lib/config.mjs';
import { parsePromptGroups } from '../evaluation/scripts/lib/tasks.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultOutputPath = resolve(frontRoot, 'eval-output/core-criteria-candidates.json');
const allowedLevels = new Set(['gating', 'should', 'quality']);
const allowedConfidence = new Set(['high', 'medium', 'low']);

const systemPrompt = `你是前端基准评测标准设计专家。你的任务不是评价某个作品是否完成，而是给既有验收标准标注重要性。

请对每个 criterion 选择且只选择一个级别：
- gating（必达判据，mandatory criterion）：核验主要用户流程中必要步骤的可用性，或操作提交后结果状态的正确性；失败会使对应核心 Task 不通过。
- should：重要功能或完整性要求。失败会明显降分，但不一定破坏主要闭环。
- quality：视觉精致度、动画顺滑度、响应式润色、文档、锦上添花体验，或主要用于质量比较的维度。

判定规则：
1. 必须先确定整道题的主要用户流程，再横向比较所有 Task，选择覆盖关键步骤与已提交状态的 gating 集合。
2. 只有核验主要用户流程中必要操作或其结果状态正确性的 criterion 才标 gating；明示要求的刷新后状态持续性也计入。
3. 某项只是局部 Task 的主要内容，并不自动意味着它属于主要用户流程；多数非必达需求应归为 should。
4. 纯视觉题中，pointwise criterion 里决定作品身份的核心构图或主体可以是 gating；pairwise_gsb Task 只用于独立 G/S/B 质量比较，其 criteria 只能标为 should 或 quality，不进入功能核心门槛。
5. 严格遵守输入中的 max_gating_criteria 与 max_core_tasks 上限；一个 Task 含任一 gating criterion 即计为核心 Task。
6. previous_annotations 只是上一轮候选，必须主动质疑并将非整题关键项降为 should 或 quality。
7. 不根据实现难度、测试难度或模型是否容易完成来定级。
8. 不合并、不拆分、不改写 criterion_id；每个输入 criterion_id 必须恰好输出一次。
9. reason 使用简短中文，说明它为何属于该级别，不评价任何候选作品。
10. 只返回符合给定 JSON Schema 的 JSON。`;

function usage() {
  return `使用配置的评估模型生成核心 criteria 候选标注。

用法：
  node src/data-tools/annotate-core-criteria.mjs --questions=001,002

选项：
  --questions LIST          必填；题号、题目 ID、数字范围或 all
  --output PATH             候选输出，默认仓库 eval-output/core-criteria-candidates.json（不进入版本控制）
  --model NAME              上游模型 ID；默认 EVAL_MODEL 或评估器默认模型
  --model-id NAME           覆盖请求发送的上游模型 ID
  --reasoning-effort LEVEL  推理强度，默认使用模型配置
  --api-base URL            覆盖 OPENAI_BASE_URL
  --api-key-env NAME        API Key 环境变量，默认 OPENAI_API_KEY
  --max-output-tokens N     每题最大输出 token，默认 12000
  --timeout-ms N            单次请求超时，默认使用模型配置
  --concurrency N           并发请求数，默认 1
  --review-from PATH        读取上一轮候选并进行收紧复核
  --max-gating-ratio N      每题 gating 比例上限，默认 0.35
  --max-core-task-ratio N   每题核心 Task 比例上限，默认 0.50
  --env-file PATH           指定 dotenv；默认读取仓库根目录 .env
  --resume                  保留输出中已有题目并跳过
  --force                   覆盖已有输出文件
  --dry-run                 只展示选择范围，不调用模型
  -h, --help                显示帮助

示例：
  node src/data-tools/annotate-core-criteria.mjs --questions=001-003 --model=your-model-id
`;
}

function readOption(argv, index, name) {
  const current = argv[index];
  if (current === name) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a value`);
    }
    return { matched: true, value, consumed: 2 };
  }
  if (current.startsWith(`${name}=`)) {
    const value = current.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value`);
    return { matched: true, value, consumed: 1 };
  }
  return { matched: false, value: '', consumed: 0 };
}

export function parseArgs(argv) {
  const options = {
    questions: '',
    outputPath: defaultOutputPath,
    modelName: '',
    modelId: '',
    reasoningEffort: '',
    apiBase: '',
    apiKeyEnv: '',
    maxOutputTokens: 12000,
    timeoutMs: null,
    concurrency: 1,
    reviewFrom: '',
    maxGatingRatio: 0.35,
    maxCoreTaskRatio: 0.5,
    envFile: '',
    resume: false,
    force: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length;) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      options.help = true;
      index += 1;
      continue;
    }
    if (argument === '--resume') {
      options.resume = true;
      index += 1;
      continue;
    }
    if (argument === '--force') {
      options.force = true;
      index += 1;
      continue;
    }
    if (argument === '--dry-run') {
      options.dryRun = true;
      index += 1;
      continue;
    }

    const stringOptions = [
      ['--questions', 'questions'],
      ['--output', 'outputPath'],
      ['--model', 'modelName'],
      ['--model-id', 'modelId'],
      ['--reasoning-effort', 'reasoningEffort'],
      ['--api-base', 'apiBase'],
      ['--api-key-env', 'apiKeyEnv'],
      ['--review-from', 'reviewFrom'],
      ['--env-file', 'envFile'],
    ];
    let matched = false;
    for (const [name, key] of stringOptions) {
      const parsed = readOption(argv, index, name);
      if (!parsed.matched) continue;
      options[key] = parsed.value;
      index += parsed.consumed;
      matched = true;
      break;
    }
    if (matched) continue;

    const ratioOptions = [
      ['--max-gating-ratio', 'maxGatingRatio'],
      ['--max-core-task-ratio', 'maxCoreTaskRatio'],
    ];
    for (const [name, key] of ratioOptions) {
      const parsed = readOption(argv, index, name);
      if (!parsed.matched) continue;
      const value = Number(parsed.value);
      if (!Number.isFinite(value) || value <= 0 || value > 1) {
        throw new Error(`${name} must be greater than 0 and at most 1`);
      }
      options[key] = value;
      index += parsed.consumed;
      matched = true;
      break;
    }
    if (matched) continue;

    const numericOptions = [
      ['--max-output-tokens', 'maxOutputTokens'],
      ['--timeout-ms', 'timeoutMs'],
      ['--concurrency', 'concurrency'],
    ];
    for (const [name, key] of numericOptions) {
      const parsed = readOption(argv, index, name);
      if (!parsed.matched) continue;
      const value = Number(parsed.value);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
      }
      options[key] = value;
      index += parsed.consumed;
      matched = true;
      break;
    }
    if (matched) continue;

    throw new Error(`Unknown option: ${argument}`);
  }

  if (options.resume && options.force) {
    throw new Error('--resume and --force cannot be used together');
  }
  if (!options.help && !options.questions) {
    throw new Error('--questions is required');
  }
  options.outputPath = isAbsolute(options.outputPath)
    ? options.outputPath
    : resolve(process.cwd(), options.outputPath);
  if (options.envFile) {
    options.envFile = isAbsolute(options.envFile)
      ? options.envFile
      : resolve(process.cwd(), options.envFile);
  }
  if (options.reviewFrom) {
    options.reviewFrom = isAbsolute(options.reviewFrom)
      ? options.reviewFrom
      : resolve(process.cwd(), options.reviewFrom);
  }
  return options;
}

export function resolveModelConfig(modelName, environment, overrides = {}) {
  const modelId = String(overrides.modelId || modelName || environment.EVAL_MODEL || DEFAULT_EVAL_MODEL).trim();
  if (!modelId) throw new Error('An upstream model ID is required.');
  const api = resolveApiConfig({
    environment,
    apiBase: overrides.apiBase,
    apiKeyEnv: overrides.apiKeyEnv || 'OPENAI_API_KEY',
  });
  return {
    alias: modelId,
    label: modelId,
    model: modelId,
    apiUrl: `${api.apiBase}/responses`,
    apiKeyEnv: api.apiKeyEnv,
    apiKey: api.apiKey,
    authType: 'bearer',
    request: {},
    reasoning: {
      requestPath: ['reasoning', 'effort'],
      levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      default: environment.CODEX_REASONING_EFFORT || null,
    },
    retries: 3,
    timeoutMs: 3600000,
  };
}

function expandQuestionToken(token) {
  const range = token.match(/^(\d{1,3})-(\d{1,3})$/u);
  if (!range) return [token];
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (start > end) throw new Error(`Invalid question range: ${token}`);
  return Array.from({ length: end - start + 1 }, (_, offset) => String(start + offset).padStart(3, '0'));
}

export function selectQuestionGroups(groups, selector) {
  if (String(selector).trim().toLowerCase() === 'all') return [...groups];
  const tokens = String(selector)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap(expandQuestionToken);
  if (!tokens.length) throw new Error('No questions selected');

  const selectedNumbers = new Set();
  const selectedIds = new Set();
  for (const token of tokens) {
    if (/^\d{1,3}$/u.test(token)) {
      selectedNumbers.add(Number(token));
    } else {
      selectedIds.add(token);
    }
  }
  const selected = groups.filter((group) => (
    selectedNumbers.has(Number(group.number)) || selectedIds.has(group.id)
  ));
  const matchedTokens = new Set();
  for (const group of selected) {
    if (selectedNumbers.has(Number(group.number))) matchedTokens.add(String(Number(group.number)));
    if (selectedIds.has(group.id)) matchedTokens.add(group.id);
  }
  const missing = tokens.filter((token) => (
    /^\d{1,3}$/u.test(token)
      ? !matchedTokens.has(String(Number(token)))
      : !matchedTokens.has(token)
  ));
  if (missing.length) throw new Error(`Unknown questions: ${[...new Set(missing)].join(', ')}`);
  return selected;
}

function canonicalCriteria(group) {
  return group.requirements.flatMap((requirement) => (
    requirement.criteria.map((criterion, index) => ({
      criterionId: requirement.criterionIds[index],
      taskId: String(requirement.taskId),
      judgeMode: requirement.judgeMode,
      task: requirement.task,
      criterion,
    }))
  ));
}

export function annotationLimits(group, options = {}) {
  const criterionCount = canonicalCriteria(group).length;
  const taskCount = group.requirements.length;
  return {
    maxGatingCriteria: Math.max(1, Math.ceil(criterionCount * Number(options.maxGatingRatio ?? 0.35))),
    maxCoreTasks: Math.max(1, Math.ceil(taskCount * Number(options.maxCoreTaskRatio ?? 0.5))),
  };
}

function previousAnnotations(previousQuestion) {
  if (!previousQuestion) return [];
  return (previousQuestion.tasks || []).flatMap((task) => (
    (task.criteria || []).map((criterion) => ({
      criterion_id: criterion.criterion_id,
      previous_level: criterion.level,
      previous_reason: criterion.reason,
    }))
  ));
}

export function buildQuestionInput(group, previousQuestion = null, limits = null) {
  const input = {
    question: {
      number: String(group.number).padStart(3, '0'),
      id: group.id,
      category: group.category,
      prompt: group.prompt,
    },
    tasks: group.requirements.map((requirement) => ({
      task_id: String(requirement.taskId),
      judge_mode: requirement.judgeMode,
      task: requirement.task,
      criteria: requirement.criteria.map((criterion, index) => ({
        criterion_id: requirement.criterionIds[index],
        criterion,
      })),
    })),
  };
  if (limits) {
    input.selection_limits = {
      max_gating_criteria: limits.maxGatingCriteria,
      max_core_tasks: limits.maxCoreTasks,
      core_task_rule: 'A pointwise task is core when at least one criterion is mandatory (stored as gating); pairwise_gsb tasks do not enter core acceptance.',
    };
  }
  const previous = previousAnnotations(previousQuestion);
  if (previous.length) input.previous_annotations = previous;
  return input;
}

function annotationSchema(group) {
  const criterionIds = canonicalCriteria(group).map((item) => item.criterionId);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['question_id', 'annotations'],
    properties: {
      question_id: { type: 'string', const: group.id },
      annotations: {
        type: 'array',
        minItems: criterionIds.length,
        maxItems: criterionIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion_id', 'level', 'confidence', 'reason'],
          properties: {
            criterion_id: { type: 'string', enum: criterionIds },
            level: { type: 'string', enum: [...allowedLevels] },
            confidence: { type: 'string', enum: [...allowedConfidence] },
            reason: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  };
}

function setNestedValue(target, path, value) {
  let current = target;
  for (const key of path.slice(0, -1)) {
    current[key] = current[key] || {};
    current = current[key];
  }
  current[path.at(-1)] = value;
}

function buildRequestBody(
  group,
  model,
  options,
  previousQuestion,
  limits,
  validationFeedback = '',
) {
  const questionInput = buildQuestionInput(group, previousQuestion, limits);
  const feedback = validationFeedback
    ? `\n上一轮输出未通过校验：${validationFeedback}\n请重新输出完整且合法的 JSON。`
    : '';
  const body = {
    model: model.model,
    instructions: systemPrompt,
    input: `${JSON.stringify(questionInput, null, 2)}${feedback}`,
    max_output_tokens: Math.min(options.maxOutputTokens, Number(model.request.maxTokens || options.maxOutputTokens)),
    text: {
      format: {
        type: 'json_schema',
        name: 'core_criteria_annotations',
        strict: true,
        schema: annotationSchema(group),
      },
    },
    ...(model.request.extraBody || {}),
  };
  if (model.request.temperature !== null && model.request.temperature !== undefined) {
    body.temperature = model.request.temperature;
  }
  if (model.request.topP !== null && model.request.topP !== undefined) {
    body.top_p = model.request.topP;
  }
  const effort = options.reasoningEffort || model.reasoning?.default || '';
  if (effort) {
    const levels = model.reasoning?.levels || [];
    if (levels.length && !levels.includes(effort)) {
      throw new Error(`Unsupported reasoning effort ${effort} for ${model.alias}; allowed: ${levels.join(', ')}`);
    }
    setNestedValue(body, model.reasoning?.requestPath || ['reasoning', 'effort'], effort);
  }
  return body;
}

function responseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks = [];
  for (const output of payload?.output || []) {
    if (typeof output?.text === 'string') chunks.push(output.text);
    for (const content of output?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      else if (typeof content?.text?.value === 'string') chunks.push(content.text.value);
    }
  }
  const chatContent = payload?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') chunks.push(chatContent);
  if (Array.isArray(chatContent)) {
    for (const content of chatContent) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonOutput(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Model response contains no output text');
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw new Error('Model output is not valid JSON');
  }
}

export function validateModelAnnotations(group, raw, limits = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Model output must be a JSON object');
  }
  if (String(raw.question_id || '') !== group.id) {
    throw new Error(`question_id mismatch: expected=${group.id}, actual=${raw.question_id || '(empty)'}`);
  }
  if (!Array.isArray(raw.annotations)) {
    throw new Error('annotations must be an array');
  }

  const expected = canonicalCriteria(group);
  const expectedIds = new Set(expected.map((item) => item.criterionId));
  const expectedById = new Map(expected.map((item) => [item.criterionId, item]));
  const annotations = new Map();
  for (const annotation of raw.annotations) {
    const criterionId = String(annotation?.criterion_id || '').trim();
    if (!expectedIds.has(criterionId)) throw new Error(`Unknown criterion_id: ${criterionId || '(empty)'}`);
    if (annotations.has(criterionId)) throw new Error(`Duplicate criterion_id: ${criterionId}`);
    const level = String(annotation?.level || '').trim().toLowerCase();
    const confidence = String(annotation?.confidence || '').trim().toLowerCase();
    const reason = String(annotation?.reason || '').trim();
    if (!allowedLevels.has(level)) throw new Error(`Invalid level for ${criterionId}: ${level || '(empty)'}`);
    if (level === 'gating' && expectedById.get(criterionId)?.judgeMode === 'pairwise_gsb') {
      throw new Error(`pairwise_gsb criterion cannot be gating: ${criterionId}`);
    }
    if (!allowedConfidence.has(confidence)) {
      throw new Error(`Invalid confidence for ${criterionId}: ${confidence || '(empty)'}`);
    }
    if (!reason) throw new Error(`Missing reason for ${criterionId}`);
    annotations.set(criterionId, { criterionId, level, confidence, reason });
  }
  const missing = expected.filter((item) => !annotations.has(item.criterionId));
  if (missing.length) {
    throw new Error(`Missing criterion_id values: ${missing.map((item) => item.criterionId).join(', ')}`);
  }
  const ordered = expected.map((item) => annotations.get(item.criterionId));
  if (limits) {
    const gating = ordered.filter((item) => item.level === 'gating');
    const criterionToTask = new Map(expected.map((item) => [item.criterionId, item.taskId]));
    const coreTasks = new Set(gating.map((item) => criterionToTask.get(item.criterionId)));
    if (!gating.length) throw new Error('At least one criterion must be labeled gating');
    if (gating.length > limits.maxGatingCriteria) {
      throw new Error(`Too many gating criteria: ${gating.length}; maximum=${limits.maxGatingCriteria}`);
    }
    if (coreTasks.size > limits.maxCoreTasks) {
      throw new Error(`Too many core tasks: ${coreTasks.size}; maximum=${limits.maxCoreTasks}`);
    }
  }
  return ordered;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export function redactSensitiveText(text, secrets = []) {
  let redacted = String(text || '');
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  return redacted.replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b/gu, '[REDACTED]');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function postResponses(model, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (model.authType === 'x-api-key') headers['x-api-key'] = model.apiKey;
    else headers.Authorization = `Bearer ${model.apiKey}`;
    const response = await fetch(model.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const redacted = redactSensitiveText(text, [model.apiKey]);
      throw new HttpError(response.status, `HTTP ${response.status}: ${redacted.slice(0, 2000)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Responses endpoint returned invalid JSON: ${text.slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithRetries(model, body, timeoutMs) {
  let lastError = null;
  for (let attempt = 1; attempt <= model.retries; attempt += 1) {
    try {
      return await postResponses(model, body, timeoutMs);
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError'
        || !(error instanceof HttpError)
        || error.status === 429
        || error.status >= 500;
      if (!retryable || attempt === model.retries) throw error;
      await sleep(1000 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function requestQuestionAnnotations(group, model, options, previousQuestion, limits) {
  let validationFeedback = '';
  let structuredOutput = true;
  for (let validationAttempt = 1; validationAttempt <= 3; validationAttempt += 1) {
    const body = buildRequestBody(
      group,
      model,
      options,
      previousQuestion,
      limits,
      validationFeedback,
    );
    if (!structuredOutput) delete body.text;
    let response;
    try {
      response = await requestWithRetries(model, body, options.timeoutMs || model.timeoutMs);
    } catch (error) {
      if (structuredOutput && error instanceof HttpError && [400, 404, 422].includes(error.status)) {
        structuredOutput = false;
        validationFeedback = '接口不接受结构化输出参数；请仅返回 JSON 对象，不要使用 Markdown 代码块。';
        continue;
      }
      throw error;
    }
    try {
      const annotations = validateModelAnnotations(
        group,
        parseJsonOutput(responseText(response)),
        limits,
      );
      return {
        annotations,
        responseId: response.id || null,
        usage: response.usage || null,
        structuredOutput,
      };
    } catch (error) {
      if (validationAttempt === 3) throw error;
      validationFeedback = error.message;
    }
  }
  throw new Error(`Failed to obtain valid annotations for ${group.id}`);
}

function taskLevel(criteria) {
  if (criteria.some((item) => item.level === 'gating')) return 'gating';
  if (criteria.some((item) => item.level === 'should')) return 'should';
  return 'quality';
}

export function buildQuestionResult(group, annotations, metadata = {}, limits = null) {
  const byId = new Map(annotations.map((item) => [item.criterionId, item]));
  const tasks = group.requirements.map((requirement) => {
    const criteria = requirement.criteria.map((criterion, index) => {
      const criterionId = requirement.criterionIds[index];
      const annotation = byId.get(criterionId);
      return {
        criterion_id: criterionId,
        criterion,
        level: annotation.level,
        confidence: annotation.confidence,
        reason: annotation.reason,
      };
    });
    const level = taskLevel(criteria);
    return {
      task_id: String(requirement.taskId),
      judge_mode: requirement.judgeMode,
      task: requirement.task,
      derived_level: level,
      is_core_task: level === 'gating',
      core_gate_scope: requirement.judgeMode === 'pairwise_gsb' ? 'task' : 'criteria',
      criteria,
    };
  });
  const flatCriteria = tasks.flatMap((task) => task.criteria);
  return {
    question_no: String(group.number).padStart(3, '0'),
    question_id: group.id,
    category: group.category,
    prompt: group.prompt,
    core_task_ids: tasks.filter((task) => task.is_core_task).map((task) => task.task_id),
    counts: {
      tasks: tasks.length,
      core_tasks: tasks.filter((task) => task.is_core_task).length,
      criteria: flatCriteria.length,
      gating: flatCriteria.filter((item) => item.level === 'gating').length,
      should: flatCriteria.filter((item) => item.level === 'should').length,
      quality: flatCriteria.filter((item) => item.level === 'quality').length,
    },
    selection_limits: limits
      ? {
          max_gating_criteria: limits.maxGatingCriteria,
          max_core_tasks: limits.maxCoreTasks,
        }
      : null,
    model_response: {
      id: metadata.responseId || null,
      structured_output: metadata.structuredOutput ?? null,
      usage: metadata.usage || null,
    },
    tasks,
  };
}

function buildDocument(model, options) {
  return {
    version: 2,
    kind: 'core-criteria-candidates',
    review_required: true,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: {
      prompt_repository: '.',
    },
    generator: {
      model_alias: model.alias,
      model: model.model,
      reasoning_effort: model.reasoning?.selected || model.reasoning?.default || null,
    },
    calibration: {
      mode: options.reviewFrom ? 'second_pass_review' : 'question_level_strict',
      review_from: options.reviewFrom
        ? relative(promptRoot, options.reviewFrom).replace(/\\/gu, '/')
        : null,
      max_gating_ratio: options.maxGatingRatio,
      max_core_task_ratio: options.maxCoreTaskRatio,
    },
    definitions: {
      gating: '必达判据（mandatory criterion）：核验主要用户流程中必要步骤的可用性或已提交状态的正确性；失败使所属核心任务不通过。',
      should: '重要功能或完整性要求；失败会降分，但不一定破坏主要闭环。',
      quality: '视觉、动效、响应式、文档或锦上添花体验。',
      core_task_derivation: 'pointwise Task 含任一 gating（必达）判据，则该 Task 为核心 Task。',
      pairwise_note: 'pairwise_gsb 按 Task 级 G/S/B 独立披露；其子项仅标为 should 或 quality，不进入功能核心门槛。',
    },
    summary: {},
    questions: [],
  };
}

function updateSummary(document) {
  const tasks = document.questions.flatMap((question) => question.tasks || []);
  const criteria = tasks.flatMap((task) => task.criteria || []);
  document.summary = {
    questions: document.questions.length,
    tasks: tasks.length,
    core_tasks: tasks.filter((task) => task.is_core_task).length,
    criteria: criteria.length,
    gating: criteria.filter((item) => item.level === 'gating').length,
    should: criteria.filter((item) => item.level === 'should').length,
    quality: criteria.filter((item) => item.level === 'quality').length,
  };
  document.updated_at = new Date().toISOString();
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

export function validateSourceQuestions(document, groups) {
  if (!Array.isArray(document.questions)) throw new Error('Candidate annotations must contain questions.');
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set();
  for (const question of document.questions) {
    const group = groupsById.get(question.question_id);
    if (!group || seen.has(group.id) || question.question_no !== String(group.number).padStart(3, '0')
      || question.prompt !== group.prompt || !Array.isArray(question.tasks)) {
      throw new Error(`Question changed since annotations were generated: ${question.question_id}`);
    }
    seen.add(group.id);
    const expected = group.requirements.map((requirement) => [
      String(requirement.taskId), requirement.judgeMode, requirement.task,
      requirement.criterionIds, requirement.criteria,
    ]);
    const actual = question.tasks.map((task) => [
      task.task_id, task.judge_mode, task.task,
      task.criteria?.map((criterion) => criterion.criterion_id),
      task.criteria?.map((criterion) => criterion.criterion),
    ]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Criteria changed since annotations were generated: ${group.id}`);
    }
  }
}

function loadOutput(options, model, groups) {
  if (!existsSync(options.outputPath) || options.force) return buildDocument(model, options);
  if (!options.resume) {
    throw new Error(`Output already exists: ${options.outputPath}; use --resume or --force`);
  }
  const document = JSON.parse(readFileSync(options.outputPath, 'utf8'));
  if (document.kind !== 'core-criteria-candidates' || document.version !== 2) {
    throw new Error(`Unsupported output file: ${options.outputPath}`);
  }
  validateSourceQuestions(document, groups);
  if (document.generator?.model_alias !== model.alias) {
    throw new Error(`Existing output uses ${document.generator?.model_alias}; requested ${model.alias}`);
  }
  return document;
}

function loadReviewQuestions(options, groups, selectedGroups) {
  if (!options.reviewFrom) return new Map();
  if (!existsSync(options.reviewFrom)) {
    throw new Error(`Review source does not exist: ${options.reviewFrom}`);
  }
  const document = JSON.parse(readFileSync(options.reviewFrom, 'utf8'));
  if (document.kind !== 'core-criteria-candidates' || document.version !== 2) {
    throw new Error(`Unsupported review source: ${options.reviewFrom}`);
  }
  validateSourceQuestions(document, groups);
  const byId = new Map((document.questions || []).map((question) => [question.question_id, question]));
  const missing = selectedGroups.filter((group) => !byId.has(group.id));
  if (missing.length) {
    throw new Error(`Review source is missing questions: ${missing.map((group) => group.id).join(', ')}`);
  }
  return byId;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const repository = parsePromptGroups(promptRoot);
  const selectedGroups = selectQuestionGroups(repository.groups, options.questions);
  const selectedCriteria = selectedGroups.reduce(
    (total, group) => total + canonicalCriteria(group).length,
    0,
  );
  console.log(`Selected ${selectedGroups.length} question(s), ${selectedCriteria} criteria.`);
  for (const group of selectedGroups) {
    console.log(`- ${String(group.number).padStart(3, '0')} ${group.id}: ${group.requirements.length} tasks, ${canonicalCriteria(group).length} criteria`);
  }
  if (options.dryRun) return;

  const environment = loadEnvironment(options.envFile);
  const model = resolveModelConfig(options.modelName, environment, {
    apiBase: options.apiBase,
    apiKeyEnv: options.apiKeyEnv,
    modelId: options.modelId,
  });
  const effort = options.reasoningEffort || model.reasoning?.default || '';
  model.reasoning = model.reasoning ? { ...model.reasoning, selected: effort } : null;
  const reviewQuestions = loadReviewQuestions(options, repository.groups, selectedGroups);
  const document = loadOutput(options, model, repository.groups);
  const existingIds = new Set((document.questions || []).map((question) => question.question_id));

  const pendingGroups = selectedGroups.filter((group) => {
    if (!options.resume || !existingIds.has(group.id)) return true;
    console.log(`Skip ${group.id}: already present in ${options.outputPath}`);
    return false;
  });
  let nextGroupIndex = 0;
  const failures = [];
  const worker = async () => {
    while (nextGroupIndex < pendingGroups.length) {
      const group = pendingGroups[nextGroupIndex];
      nextGroupIndex += 1;
      console.log(`Annotating ${String(group.number).padStart(3, '0')} ${group.id} with ${model.model}...`);
      try {
        const limits = annotationLimits(group, options);
        const result = await requestQuestionAnnotations(
          group,
          model,
          options,
          reviewQuestions.get(group.id) || null,
          limits,
        );
        const question = buildQuestionResult(group, result.annotations, result, limits);
        document.questions = [
          ...(document.questions || []).filter((item) => item.question_id !== group.id),
          question,
        ].sort((left, right) => Number(left.question_no) - Number(right.question_no));
        updateSummary(document);
        writeJsonAtomic(options.outputPath, document);
        console.log(
          `  ${group.id}: gating=${question.counts.gating}, should=${question.counts.should}, quality=${question.counts.quality}, core_tasks=${question.counts.core_tasks}`,
        );
      } catch (error) {
        failures.push({ questionId: group.id, message: error.message });
        console.error(`  ${group.id}: failed: ${error.message}`);
      }
    }
  };
  const workerCount = Math.min(options.concurrency, Math.max(1, pendingGroups.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failures.length) {
    throw new Error(`${failures.length} question(s) failed: ${failures.map((item) => item.questionId).join(', ')}`);
  }

  console.log(`Wrote candidate annotations: ${options.outputPath}`);
  console.log('Review the candidates before using them as an authoritative scoring policy.');
}

if (resolve(process.argv[1] || '') === scriptPath) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
