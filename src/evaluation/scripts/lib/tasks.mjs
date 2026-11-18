import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const JUDGE_MODE_POINTWISE = 'pointwise';
export const JUDGE_MODE_PAIRWISE_GSB = 'pairwise_gsb';

export const POINTWISE_LEAF_STATUSES = Object.freeze([
  'pass',
  'fail',
  'blocked/network',
  'error',
]);
export const TASK_STATUSES = Object.freeze([
  'completed',
  'blocked',
  'needs_review',
]);
export const GSB_VALUES = Object.freeze(['G', 'S', 'B']);
export const GSB_SCORES = Object.freeze({ G: 1, S: 0.5, B: 0 });

const POINTWISE_VALUES = new Set(['pointwise', '0', 'false', 'no']);
const PAIRWISE_GSB_VALUES = new Set(['pairwise_gsb', 'gsb', '1', 'true', 'yes']);

export function normalizeJudgeMode(value, label = 'judge_mode') {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || POINTWISE_VALUES.has(normalized)) {
    return JUDGE_MODE_POINTWISE;
  }
  if (PAIRWISE_GSB_VALUES.has(normalized)) {
    return JUDGE_MODE_PAIRWISE_GSB;
  }
  throw new Error(
    `Invalid ${label}: ${value}. Expected pointwise/pairwise_gsb or 0/1.`,
  );
}

export function isPointwiseLeafStatus(value) {
  return POINTWISE_LEAF_STATUSES.includes(String(value || '').trim());
}

export function isTaskStatus(value) {
  return TASK_STATUSES.includes(String(value || '').trim().toLowerCase());
}

export function normalizeGsb(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return null;
  const normalized = String(value ?? '').trim().toUpperCase();
  return GSB_VALUES.includes(normalized) ? normalized : null;
}

function objectFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected an object for ${label}`);
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new Error(`Unknown field ${key} in ${label}`);
  }
  if (Object.hasOwn(value, '$schema') && typeof value.$schema !== 'string') {
    throw new Error(`Invalid $schema in ${label}`);
  }
}

function nonemptyText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing or invalid ${label}`);
  }
  return value;
}

function identifier(value, label) {
  nonemptyText(value, label);
  if (/\s/u.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function nonemptyArray(value, label) {
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`Missing or empty ${label} array`);
  }
}

function parseJson(text, filePath) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function readText(root, relativePath, label, extension) {
  nonemptyText(relativePath, `${label} path`);
  const path = resolve(root, relativePath);
  const localPath = relative(root, path);
  if (isAbsolute(relativePath) || localPath === '..' || localPath.startsWith(`..${sep}`)) {
    throw new Error(`${label} path must stay inside the prompt repository: ${relativePath}`);
  }
  if (extension && !relativePath.endsWith(extension)) {
    throw new Error(`${label} must be a ${extension} file: ${relativePath}`);
  }
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
  const realRelativePath = relative(realpathSync(root), realpathSync(path));
  if (realRelativePath === '..' || realRelativePath.startsWith(`..${sep}`)) {
    throw new Error(`${label} path must stay inside the prompt repository: ${relativePath}`);
  }
  if (!statSync(path).isFile()) throw new Error(`${label} must be a file: ${path}`);
  return { path, text: readFileSync(path, 'utf8') };
}

function renderCriteria({ instructions, criteria, validation }) {
  const sections = [];
  if (instructions) sections.push(instructions);
  sections.push(criteria.map((text, index) => `${index + 1}. ${text}`).join('\n'));
  if (validation) {
    sections.push(`**${validation.description}**：\n${validation.steps.map((step) => `- ${step}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

export function parseJudgeJson(text, filePath = 'judge JSON', questionId = '') {
  const document = parseJson(text, filePath);
  objectFields(document, ['$schema', 'schema_version', 'question_id', 'tasks'], filePath);
  if (document.schema_version !== 1) throw new Error(`Unsupported Judge schema_version in ${filePath}`);
  identifier(document.question_id, `question_id in ${filePath}`);
  if (questionId && document.question_id !== questionId) {
    throw new Error(`Judge question_id mismatch in ${filePath}: expected=${questionId}, actual=${document.question_id}`);
  }
  nonemptyArray(document.tasks, `tasks in ${filePath}`);
  const seenTasks = new Set();
  const seenCriteria = new Set();
  return document.tasks.map((item) => {
    objectFields(item, ['task_id', 'judge_mode', 'task', 'instructions', 'criteria', 'validation'], filePath);
    const taskId = identifier(item.task_id, `task_id in ${filePath}`);
    const label = `task_id=${taskId} in ${filePath}`;
    if (seenTasks.has(taskId)) throw new Error(`Duplicate ${label}`);
    seenTasks.add(taskId);
    if (![JUDGE_MODE_POINTWISE, JUDGE_MODE_PAIRWISE_GSB].includes(item.judge_mode)) {
      throw new Error(`Invalid judge_mode for ${label}: expected pointwise/pairwise_gsb`);
    }
    const task = nonemptyText(item.task, `task for ${label}`);
    const instructions = item.instructions === undefined ? '' : nonemptyText(item.instructions, `instructions for ${label}`);
    nonemptyArray(item.criteria, `criteria for ${label}`);
    const criteria = [];
    const criterionIds = [];
    for (const criterion of item.criteria) {
      objectFields(criterion, ['criterion_id', 'text'], `criterion for ${label}`);
      const criterionId = identifier(criterion.criterion_id, `criterion_id for ${label}`);
      if (!criterionId.startsWith(`${taskId}.`) || criterionId === `${taskId}.`) {
        throw new Error(`criterion_id ${criterionId} must belong to ${label}`);
      }
      if (seenCriteria.has(criterionId)) throw new Error(`Duplicate criterion_id=${criterionId} in ${filePath}`);
      seenCriteria.add(criterionId);
      criterionIds.push(criterionId);
      criteria.push(nonemptyText(criterion.text, `criterion text for ${criterionId} in ${filePath}`));
    }
    let validation = null;
    if (item.validation !== undefined) {
      objectFields(item.validation, ['description', 'steps'], `validation for ${label}`);
      const description = nonemptyText(item.validation.description, `validation description for ${label}`);
      nonemptyArray(item.validation.steps, `validation steps for ${label}`);
      validation = {
        description,
        steps: item.validation.steps.map((step) => nonemptyText(step, `validation step for ${label}`)),
      };
    }
    const result = { taskId, judgeMode: item.judge_mode, task, instructions, criteria, criterionIds, validation };
    return { ...result, criteriaText: renderCriteria(result) };
  });
}

export function parsePromptGroups(inputRoot) {
  const root = resolve(inputRoot);
  const datasetFile = readText(root, 'dataset.json', 'dataset index', '.json');
  const datasetPath = datasetFile.path;
  const dataset = parseJson(datasetFile.text, datasetPath);
  objectFields(dataset, ['$schema', 'schema_version', 'questions'], datasetPath);
  if (dataset.schema_version !== 1) throw new Error(`Unsupported dataset schema_version in ${datasetPath}`);
  nonemptyArray(dataset.questions, `questions in ${datasetPath}`);

  const groups = [];
  const selectionAudit = [];
  const seenNumbers = new Set();
  const seenIds = new Set();
  const seenFiles = new Set();

  for (const question of dataset.questions) {
    objectFields(question, ['number', 'id', 'categories', 'prompt_file', 'judge_file'], datasetPath);
    const number = question.number;
    const id = identifier(question.id, `question id in ${datasetPath}`);
    if (!Number.isInteger(number) || number < 1) throw new Error(`Invalid question number in ${datasetPath}`);
    if (seenNumbers.has(number)) throw new Error(`Duplicate question number ${number} in ${datasetPath}`);
    if (seenIds.has(id)) throw new Error(`Duplicate question id ${id} in ${datasetPath}`);
    seenNumbers.add(number);
    seenIds.add(id);
    nonemptyArray(question.categories, `categories for ${id}`);
    const categories = question.categories.map((category) => nonemptyText(category, `category for ${id}`));
    const taskFile = readText(root, question.prompt_file, `prompt for ${id}`, '.md');
    const judgeFile = readText(root, question.judge_file, `judge for ${id}`, '.json');
    nonemptyText(taskFile.text, `prompt for ${id}`);
    for (const file of [taskFile, judgeFile]) {
      if (seenFiles.has(file.path)) throw new Error(`Duplicate dataset file: ${file.path}`);
      seenFiles.add(file.path);
    }
    const requirements = parseJudgeJson(judgeFile.text, judgeFile.path, id).map((item, index) => ({
      row: index + 1,
      ...item,
      originalCriteria: item.criteriaText,
      criteriaSource: 'criteria',
      automation: '',
    }));
    const group = {
      row: number,
      number,
      taskKey: String(number).padStart(3, '0'),
      id,
      category: categories.join(' / '),
      prompt: taskFile.text.trim(),
      testedUrl: '',
      benchmarkUrl: '',
      requirements,
      source: {
        type: 'prompt-repository',
        root,
        datasetPath,
        taskPath: taskFile.path,
        judgePath: judgeFile.path,
      },
    };
    groups.push(group);
    selectionAudit.push({
      row: number,
      number,
      id,
      testedUrl: '',
      selected: false,
      reason: 'Prompt repository loaded; a tested URL must be supplied by --url or the runs workspace launcher.',
    });
  }

  return {
    groups,
    selectionAudit,
    source: { type: 'prompt-repository', path: root, datasetPath, dataset },
  };
}

export function groupSearchText(group) {
  return [
    group.id,
    group.category,
    group.prompt,
    ...(group.requirements || []).flatMap((item) => [
      item.task,
      item.criteriaText,
    ]),
  ].join('\n');
}

const currentRepositoryProfiles = {
  'frontenjoyai-001': 'traffic-curve',
  'frontenjoyai-002': 'pos-config',
  'frontenjoyai-003': 'iphone-site',
  'frontenjoyai-004': 'travel-app',
  'frontenjoyai-005': 'blood-circulation-svg',
  'frontenjoyai-006': 'siamese-nyc-svg',
  'frontenjoyai-007': 'planet-game',
  'frontenjoyai-008': 'pixel-rpg',
  'frontenjoyai-009': 'marketing-toolbox',
  'frontenjoyai-010': 'demo-particles',
  'frontenjoyai-011': 'demo-shape',
  'frontenjoyai-012': 'cryogenic-quench',
  'frontenjoyai-013': 'css-3d-watch',
  'frontenjoyai-014': 'rps-training-dashboard',
  'frontenjoyai-015': 'magic-skill-tree',
  'frontenjoyai-016': 'three-product-landing',
  'frontenjoyai-017': 'data-news-dashboard',
  'frontenjoyai-018': 'liquid-pouring-simulator',
  'frontenjoyai-019': 'lattice-migration-3d',
  'frontenjoyai-020': 'mobile-finance-dashboard',
  'frontenjoyai-021': 'waste-sorting-game',
  'frontenjoyai-022': 'wildlife-alert-review',
  'frontenjoyai-023': 'fps-arena',
  'frontenjoyai-024': 'engine-simulator',
  'frontenjoyai-025': 'baseball-simulator',
  'frontenjoyai-026': 'svg-poster-generator',
  'frontenjoyai-027': 'canvas-image-editor',
  'frontenjoyai-028': 'json-transform-workbench',
  'frontenjoyai-029': 'octopus-drum-svg',
  'frontenjoyai-030': 'evidence-timeline-review',
};

export function detectProfile(group) {
  const text = groupSearchText(group);
  if (/鹈鹕|自行车|蹬踏|车轮|喉囊/u.test(text)) return 'pelican-bike-svg';
  const repositoryProfile = currentRepositoryProfiles[String(group.id || '').trim()];
  if (repositoryProfile) return repositoryProfile;
  if (/流量曲线|累计占比|user_layer|144\s*个点|10\s*分钟|flow_values|cumulative_ratio/u.test(text)) return 'traffic-curve';
  if (/营销百宝箱|促销查询|优惠券查询|价格巡检|智能助手/u.test(text)) return 'marketing-toolbox';
  if (/POS|入驻任务|租户|母版|重新创建|保存草稿|执行发布|配置编辑/u.test(text)) return 'pos-config';
  if (/Halvorsen|Dual Helix|De Jong|Torus Knot|自动循环切换各类形态/u.test(text)) return 'demo-particles';
  if (/入水|引线燃烧|爆炸|气泡膨胀|水柱|玻璃缸|时间缩放/u.test(text)) return 'underwater-firecracker';
  if (/iPhone|Apple|容量选配|产品画廊|机型|官网气质/u.test(text)) return 'iphone-site';
  if (/旅行|酒店|预订 App|我的行程|Tab Bar|入住|退房|目的地/u.test(text)) return 'travel-app';
  if (/人体血液循环|四心腔|肺循环|体循环|主动脉|肺动脉瓣|二尖瓣|含氧血|缺氧血/u.test(text)) return 'blood-circulation-svg';
  if (/暹罗猫|纽约|曼哈顿|天际线|猫毛/u.test(text)) return 'siamese-nyc-svg';
  if (/球心重力|金环|怪物球面|cel-shaded|第三人称/u.test(text)) return 'planet-game';
  if (/格步进|FIGHT|DEX|PARTY|复古 4-bit|草丛|存档系统/u.test(text)) return 'pixel-rpg';
  if (/液氮|低温物理|杜瓦|膜态沸腾|蒸气膜失稳|核态沸腾|冷雾/u.test(text)) return 'cryogenic-quench';
  if (/镂空机芯|高级制表|计时码表|表镜|摆轮|擒纵|三针同轴/u.test(text)) return 'css-3d-watch';
  if (/rock\/paper\/scissors|RPS|出拳|赛前预测|best of 15|时光回溯|欺骗 AI/u.test(text)) return 'rps-training-dashboard';
  if (/魔法学院|技能树|SpellNode|mastery|符文排序|分院考试|补习路径/u.test(text)) return 'magic-skill-tree';
  if (/易拉罐|经典红|零糖黑|柑橘限定|摇一摇|检查模式|Canvas 标签/u.test(text)) return 'three-product-landing';
  if (/数据新闻|字段类型推断|自动看板|候选洞察|small-multiples|可视化看板/u.test(text)) return 'data-news-dashboard';
  if (/接收杯|倾倒|液面随重力|出水判定|抛物线水流|体积守恒|puddle/u.test(text)) return 'liquid-pouring-simulator';
  if (/晶格|原子位点|迁移路径|能垒|掺杂|空位|配位多面体/u.test(text)) return 'lattice-migration-3d';
  if (/交易详情|本月收支|现金流摘要|分类预算|转账二次确认|支付卡|卡片切换/u.test(text)) return 'mobile-finance-dashboard';
  if (/垃圾桶|垃圾分类|待复习|MistakeRecord|错题 replay|危险品守护者/u.test(text)) return 'waste-sorting-game';
  if (/野生动物|复核进度|误报率|suppressionWindowMinutes|false positive|离线相机|告警队列/u.test(text)) return 'wildlife-alert-review';
  if (/Pulse Arena|Pointer Lock|Scout|Heavy|Weapon Evolved|生存竞技场|准星/u.test(text)) return 'fps-arena';
  if (/crank-slider|四冲程|活塞|P-V|气门升程|点火提前角|1-3-4-2/u.test(text)) return 'engine-simulator';
  if (/棒球|逐球|打线轮转|垒上|投手体力|box score|高飞牺牲|双杀/u.test(text)) return 'baseball-simulator';
  if (/NEON HARBOR|Geometric Pulse|Swiss Grid|Night Signal|SVG 海报|二维码占位/u.test(text)) return 'svg-poster-generator';
  if (/Canvas 图像编辑|图像编辑器|马赛克|裁切框|标注图层|画笔标注|导出 PNG\/JPEG/u.test(text)) return 'canvas-image-editor';
  if (/JSONPath|Original\/Result|Transformation Pipeline|Commit Filter|Flatten|Explode|Group By|JSON 工作台/u.test(text)) return 'json-transform-workbench';
  if (/章鱼|鼓槌|踩镲|爵士鼓|鼓面震动|八腕/u.test(text)) return 'octopus-drum-svg';
  if (/卷宗审阅|CitationLink|证据关系|矛盾检测|Annotation\+Span|引用链|半开时间/u.test(text)) return 'evidence-timeline-review';
  if (/球体|星形|节点|连接线|深色星空|能量波纹|玻璃拟态|辉光/u.test(text)) return 'demo-shape';
  return 'generic';
}
