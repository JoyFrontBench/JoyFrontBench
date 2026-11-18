import test from 'node:test';
import assert from 'node:assert/strict';

import { detectProfile } from '../scripts/lib/tasks.mjs';

function group(overrides = {}) {
  return {
    id: 'unknown',
    category: '',
    prompt: '',
    requirements: [],
    ...overrides,
  };
}

test('detectProfile identifies known and generic tasks', () => {
  assert.equal(
    detectProfile(
      group({
        requirements: [
          { task: '球体和星形切换', criteriaText: '节点和连接线清晰' },
        ],
      }),
    ),
    'demo-shape',
  );
  assert.equal(
    detectProfile(group({ prompt: '导入 CSV 并生成 144 个点的流量曲线' })),
    'traffic-curve',
  );
  assert.equal(detectProfile(group({ prompt: '普通静态页面' })), 'generic');
});

test('detectProfile maps all current prompt repository ids', () => {
  const expected = {
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

  for (const [id, profile] of Object.entries(expected)) {
    assert.equal(detectProfile(group({ id })), profile, id);
  }
});

test('detectProfile recognizes new topics from judge text without a known id', () => {
  assert.equal(
    detectProfile(group({ prompt: '液氮杜瓦中的膜态沸腾与核态沸腾演示' })),
    'cryogenic-quench',
  );
  assert.equal(
    detectProfile(group({ prompt: '导入 CSV 后自动生成数据新闻可视化看板' })),
    'data-news-dashboard',
  );
  assert.equal(
    detectProfile(group({ prompt: 'JSONPath、Flatten、Explode 与 Group By 转换工作台' })),
    'json-transform-workbench',
  );
  assert.equal(
    detectProfile(group({ prompt: '卷宗审阅中的 CitationLink 与结构化矛盾检测' })),
    'evidence-timeline-review',
  );
});

test('detectProfile preserves content-based pelican compatibility', () => {
  assert.equal(
    detectProfile(group({ id: 'frontenjoyai-005', prompt: '绘制鹈鹕骑自行车，喉囊与蹬踏动画清晰' })),
    'pelican-bike-svg',
  );
});
