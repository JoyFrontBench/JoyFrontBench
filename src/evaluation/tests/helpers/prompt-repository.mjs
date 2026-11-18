import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writePromptRepository(root, questions) {
  mkdirSync(join(root, 'tasks'), { recursive: true });
  mkdirSync(join(root, 'judge'), { recursive: true });
  const records = questions.map((question) => {
    const promptFile = `tasks/${question.id}.md`;
    const judgeFile = `judge/${question.id}.json`;
    const tasks = question.tasks.map((task) => ({
      ...task,
      judge_mode: task.judge_mode ?? 'pointwise',
      criteria: task.criteria.map((criterion, index) => (
        typeof criterion === 'string'
          ? { criterion_id: `${task.task_id}.${index + 1}`, text: criterion }
          : criterion
      )),
    }));
    writeFileSync(join(root, promptFile), question.prompt ?? '实现测试页面。\n');
    writeFileSync(join(root, judgeFile), `${JSON.stringify({
      schema_version: 1,
      question_id: question.id,
      tasks,
    }, null, 2)}\n`);
    return {
      number: question.number,
      id: question.id,
      categories: question.categories ?? ['测试'],
      prompt_file: promptFile,
      judge_file: judgeFile,
    };
  });
  const dataset = { schema_version: 1, questions: records };
  writeFileSync(join(root, 'dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`);
  return dataset;
}
