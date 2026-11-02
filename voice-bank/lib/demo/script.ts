// Director script for the 300-second demo video (规划文档 v1.0 §三). Lines come from
// voice-lines.json; actions run the same handlers a viewer's clicks would.
import type { Chapter } from './timeline.ts';

export const VIDEO_SECONDS = 300;

export const CHAPTERS: Chapter[] = [
  {
    id: 'intro', scene: 'intro', title: '冷开场 · 她已经会自己安排了', target: [0, 12],
    beats: [
      { line: 's0-xz', lead: 0.9, hold: 0.25, do: [
        [0, { k: 'scene', scene: 'intro' }],
        [0.05, { k: 'lower', text: '24 岁 · 第一份工资', sub: '2026 · 初入职场' }],
        [0.25, { k: 'run', op: 'intro-salary' }],
        [0.6, { k: 'run', op: 'intro-map' }],
        ['L-0.6', { k: 'user', line: 's0-xz', mode: 'voice' }],
        ['L+1.5', { k: 'cursor', to: 'intro-basis', dur: 0.7 }],
        ['L+2.6', { k: 'click', target: 'intro-basis' }],
      ] },
      { line: 's0-nr', lead: 0.1, hold: 0.35, do: [
        ['L+3.9', { k: 'overlay', kind: 'rewind' }],
      ] },
    ],
  },
  {
    id: 'transfer', scene: 'transfer', title: '大二 · 智能转账', target: [12, 67],
    beats: [
      { line: 's1-xz-1', lead: 0.7, hold: 1.4, do: [
        [0, { k: 'scene', scene: 'transfer' }],
        [0.05, { k: 'overlay', kind: null }],
        [0.1, { k: 'lower', text: '20 岁 · 大二', sub: '周四晚 · 宿舍' }],
        ['L-0.6', { k: 'user', line: 's1-xz-1', mode: 'voice' }],
        ['E+0.35', { k: 'run', op: 'tr-search' }],
        ['E+0.9', { k: 'highlight', target: 'tr-candidates', dur: 1.4 }],
      ] },
      { line: 's1-gs-1', hold: 2.4, do: [
        ['L-1.2', { k: 'goose', line: 's1-gs-1' }],
        ['L+2.4', { k: 'cursor', to: 'cand-ZS-BADM-7291', dur: 0.8 }],
        ['L+3.6', { k: 'click', target: 'cand-ZS-BADM-7291' }],
      ] },
      { line: 's1-xz-2', lead: 0.3, hold: 0.6, do: [
        ['L-0.6', { k: 'user', line: 's1-xz-2', mode: 'voice' }],
        ['E+0.2', { k: 'run', op: 'tr-voice-confirm' }],
        ['E+0.25', { k: 'caption', text: '语音“确认” ≠ 支付授权', dur: 3.2 }],
      ] },
      { line: 's1-nr-1', hold: 3.6, do: [
        ['L+0.6', { k: 'highlight', target: 'voice-notice', dur: 1.6 }],
        ['L+1.6', { k: 'cursor', to: 'tr-confirm', dur: 0.7 }],
        ['L+2.5', { k: 'click', target: 'tr-confirm' }],
        ['L+3.4', { k: 'cursor', to: 'auth-ok', dur: 0.6 }],
        ['L+4.2', { k: 'click', target: 'auth-ok' }],
        ['E+1.0', { k: 'highlight', target: 'tr-receipt', dur: 1.8 }],
      ] },
      { line: 's1-xz-3', lead: 0.3, hold: 0.5, do: [
        [0, { k: 'run', op: 'collapse-transfer' }],
        [0.1, { k: 'lower', text: '20 岁 · 大二', sub: '聚餐后 · 分项 AA' }],
        ['L-0.6', { k: 'user', line: 's1-xz-3', mode: 'voice' }],
        ['L+3.6', { k: 'run', op: 'aa-v1' }],
        ['E+0.3', { k: 'run', op: 'aa-v2' }],
      ] },
      { line: 's1-gs-2', hold: 2.4, do: [
        ['L-1.2', { k: 'goose', line: 's1-gs-2' }],
        ['L+0.6', { k: 'highlight', target: 'aa-assert', dur: 2.2 }],
        ['E+0.2', { k: 'cursor', to: 'aa-confirm', dur: 0.7 }],
        ['E+1.1', { k: 'click', target: 'aa-confirm' }],
      ] },
      { min: 4.6, do: [
        [0.2, { k: 'lower', text: '次日', sub: '合成收款记录 · 模拟回调' }],
        [0.4, { k: 'run', op: 'aa-nextday' }],
        [1.6, { k: 'highlight', target: 'aa-split', dur: 2.0 }],
        [2.6, { k: 'cursor', to: 'aa-remind', dur: 0.7 }],
        [3.5, { k: 'click', target: 'aa-remind' }],
      ] },
      { line: 's1-nr-2', lead: 0.4, hold: 3.1, do: [
        ['L+0.2', { k: 'highlight', target: 'aa-columns', dur: 2.4 }],
        ['L+3.4', { k: 'milestone', id: 'verify', event: 'payee_and_amount_verified', basis: '主动核对同名收款人、金额和用途' }],
      ] },
    ],
  },
  {
    id: 'bills', scene: 'bills', title: '月末 · 账单＋订阅', target: [67, 127],
    beats: [
      { line: 's2-xz-1', lead: 0.8, hold: 2.4, do: [
        [0, { k: 'scene', scene: 'bills' }],
        [0.1, { k: 'lower', text: '20 岁 · 同一个月末', sub: '开始独立管理生活费' }],
        ['L-0.6', { k: 'user', line: 's2-xz-1', mode: 'text' }],
        ['E+0.3', { k: 'run', op: 'bill-summary' }],
        ['E+0.9', { k: 'highlight', target: 'bill-scope', dur: 1.6 }],
      ] },
      { line: 's2-gs-1', hold: 1.0, do: [
        ['L-1.2', { k: 'goose', line: 's2-gs-1' }],
        ['L+0.3', { k: 'highlight', target: 'tag-infer', dur: 2.6 }],
        ['L+4.0', { k: 'highlight', target: 'bill-missing', dur: 2.2 }],
        ['L+7.2', { k: 'cursor', to: 'tx-correct', dur: 0.8 }],
      ] },
      { line: 's2-nr-1', hold: 3.1, do: [
        ['L+0.1', { k: 'click', target: 'tx-correct' }],
        ['L+0.9', { k: 'cursor', to: 'cat-study', dur: 0.5 }],
        ['L+1.6', { k: 'click', target: 'cat-study' }],
        ['L+2.6', { k: 'highlight', target: 'tx-scope', dur: 1.6 }],
        ['L+4.6', { k: 'highlight', target: 'fed-local', dur: 2.4 }],
        ['L+7.6', { k: 'highlight', target: 'fed-queue', dur: 2.4 }],
        ['L+10.4', { k: 'highlight', target: 'fed-gate', dur: 2.8 }],
      ] },
      { line: 's2-gs-2', lead: 0.6, hold: 1.6, do: [
        [0, { k: 'run', op: 'collapse-bills' }],
        [0.2, { k: 'run', op: 'sub-radar' }],
        ['L-1.2', { k: 'goose', line: 's2-gs-2' }],
        ['L+3.2', { k: 'cursor', to: 'sub-stop-SUB-VIDEO-25', dur: 0.7 }],
        ['L+4.1', { k: 'click', target: 'sub-stop-SUB-VIDEO-25' }],
        ['L+5.0', { k: 'cursor', to: 'sub-stop-SUB-MUSIC-31', dur: 0.6 }],
        ['L+5.8', { k: 'click', target: 'sub-stop-SUB-MUSIC-31' }],
      ] },
      { line: 's2-nr-2', hold: 2.9, do: [
        ['L+0.1', { k: 'cursor', to: 'sub-confirm', dur: 0.6 }],
        ['L+0.9', { k: 'click', target: 'sub-confirm' }],
        ['L+1.6', { k: 'caption', text: '已提交 ≠ 已取消', dur: 3.0 }],
        ['L+2.0', { k: 'highlight', target: 'sub-state-bank', dur: 1.0 }],
        ['L+3.0', { k: 'highlight', target: 'sub-state-merchant', dur: 1.0 }],
        ['L+4.0', { k: 'highlight', target: 'sub-state-refund', dur: 1.0 }],
        ['L+5.0', { k: 'highlight', target: 'sub-state-check', dur: 1.2 }],
        ['E+0.6', { k: 'highlight', target: 'sub-external', dur: 1.6 }],
      ] },
      { line: 's2-xz-2', hold: 3.4, do: [
        ['L-0.6', { k: 'user', line: 's2-xz-2', mode: 'voice' }],
        ['E+0.2', { k: 'milestone', id: 'understand', event: 'category_corrected_by_user', basis: '能区分流水事实、分类推断与数据缺口' }],
        ['E+1.4', { k: 'milestone', id: 'manage', event: 'subscription_states_explained', basis: '能区分通道解约、商户退订、退款与待核验' }],
      ] },
    ],
  },
  {
    id: 'cards', scene: 'cards', title: '异常夜晚 · 卡片', target: [127, 162],
    beats: [
      { line: 's3-gs-1', lead: 3.6, hold: 2.2, do: [
        [0, { k: 'scene', scene: 'cards' }],
        [0.1, { k: 'lower', text: '21 岁 · 异常交易夜晚', sub: '23:48' }],
        [0.5, { k: 'run', op: 'anomaly-review' }],
        ['L-1.2', { k: 'goose', line: 's3-gs-1' }],
        ['L+0.4', { k: 'highlight', target: 'review-split', dur: 2.6 }],
        ['L+3.6', { k: 'highlight', target: 'anomaly-verdict', dur: 2.4 }],
      ] },
      { line: 's3-xz-1', lead: 0.2, hold: 1.9, do: [
        ['L-0.6', { k: 'user', line: 's3-xz-1', mode: 'voice' }],
        ['L+0.3', { k: 'cursor', to: 'anomaly-not-me', dur: 0.7 }],
        ['L+1.3', { k: 'click', target: 'anomaly-not-me' }],
      ] },
      { line: 's3-nr-1', hold: 4.0, do: [
        ['L+0.2', { k: 'highlight', target: 'freeze-facts', dur: 1.8 }],
        ['L+1.6', { k: 'cursor', to: 'freeze-confirm', dur: 0.6 }],
        ['L+2.4', { k: 'click', target: 'freeze-confirm' }],
        ['L+3.3', { k: 'cursor', to: 'auth-ok', dur: 0.5 }],
        ['L+4.0', { k: 'click', target: 'auth-ok' }],
        ['E+0.4', { k: 'caption', text: '临时冻结 ≠ 正式挂失', dur: 3.2 }],
      ] },
      { line: 's3-xz-2', hold: 3.9, do: [
        ['L-0.6', { k: 'user', line: 's3-xz-2', mode: 'voice' }],
        ['E+0.2', { k: 'milestone', id: 'respond', event: 'anomaly_verification_completed', basis: '异常时先核实，再按回执止损' }],
      ] },
    ],
  },
  {
    id: 'graduation', scene: 'graduation', title: '毕业转场', target: [162, 172],
    beats: [
      { line: 's4-nr-1', lead: 0.9, hold: 1.2, do: [[0, { k: 'scene', scene: 'graduation' }]] },
    ],
  },
  {
    id: 'payday', scene: 'payday', title: '第一份工资 · 跨场景＋理财', target: [172, 262],
    beats: [
      { line: 's5-xz-1', lead: 0.8, hold: 1.4, do: [
        [0, { k: 'scene', scene: 'payday' }],
        [0.1, { k: 'lower', text: '24 岁 · 发薪日', sub: '第一次独立安排正式工资' }],
        ['L-0.6', { k: 'user', line: 's5-xz-1', mode: 'voice' }],
        ['E+0.3', { k: 'run', op: 'payday-plan' }],
      ] },
      { line: 's5-gs-1', hold: 2.4, do: [
        ['L-1.2', { k: 'goose', line: 's5-gs-1' }],
        ['L+1.2', { k: 'highlight', target: 'pd-not-executed', dur: 2.4 }],
        ['E+0.3', { k: 'highlight', target: 'pd-steps', dur: 1.6 }],
      ] },
      { line: 's5-gs-2', hold: 0.4, do: [
        [0, { k: 'run', op: 'pd-basis' }],
        ['L-1.2', { k: 'goose', line: 's5-gs-2' }],
        ['L+2.6', { k: 'highlight', target: 'pd-available', dur: 2.4 }],
        ['L+5.4', { k: 'highlight', target: 'pd-budget', dur: 2.2 }],
        ['E+0.1', { k: 'cursor', to: 'budget-confirm', dur: 0.6 }],
        ['E+0.9', { k: 'click', target: 'budget-confirm' }],
        ['E+1.6', { k: 'milestone', id: 'plan', event: 'budget_tradeoff_explained', basis: '先安排必要支出和保留金，再建立目标' }],
      ] },
      { line: 's5-xz-2', lead: 3.6, hold: 0.5, do: [
        ['L-0.6', { k: 'user', line: 's5-xz-2', mode: 'voice' }],
        ['E+0.3', { k: 'run', op: 'rule-draft' }],
      ] },
      { line: 's5-nr-1', hold: 4.2, do: [
        ['L+0.4', { k: 'highlight', target: 'rule-limits', dur: 2.6 }],
        ['L+2.8', { k: 'cursor', to: 'rule-confirm', dur: 0.6 }],
        ['L+3.6', { k: 'click', target: 'rule-confirm' }],
        ['L+4.4', { k: 'cursor', to: 'auth-ok', dur: 0.5 }],
        ['L+5.0', { k: 'click', target: 'auth-ok' }],
        ['L+5.9', { k: 'cursor', to: 'firstrun-confirm', dur: 0.6 }],
        ['E+0.4', { k: 'click', target: 'firstrun-confirm' }],
      ] },
      { line: 's5-xz-3', lead: 0.4, hold: 1.6, do: [
        ['L-0.6', { k: 'user', line: 's5-xz-3', mode: 'voice' }],
        ['E+0.3', { k: 'run', op: 'invest-card' }],
      ] },
      { line: 's5-gs-3', hold: 4.6, do: [
        ['L-1.2', { k: 'goose', line: 's5-gs-3' }],
        ['L+0.3', { k: 'highlight', target: 'edu-entry', dur: 2.4 }],
        ['L+3.0', { k: 'highlight', target: 'cr-split', dur: 3.6 }],
        ['L+6.8', { k: 'run', op: 'invest-disclosure' }],
        ['L+7.6', { k: 'highlight', target: 'disclosure-risk', dur: 2.6 }],
      ] },
      { line: 's5-nr-2', hold: 5.3, do: [
        ['L+0.3', { k: 'cursor', to: 'risk-ack', dur: 0.6 }],
        ['L+1.1', { k: 'click', target: 'risk-ack' }],
        ['L+1.5', { k: 'milestone', id: 'risk', event: 'risk_and_fee_explained_by_user', basis: '能复述费用与风险，独立选择继续或退出' }],
        ['L+2.5', { k: 'cursor', to: 'invest-confirm', dur: 0.6 }],
        ['L+3.3', { k: 'click', target: 'invest-confirm' }],
        ['L+4.2', { k: 'cursor', to: 'auth-ok', dur: 0.5 }],
        ['L+4.9', { k: 'click', target: 'auth-ok' }],
        ['E+0.3', { k: 'caption', text: '受理 ≠ 成交', dur: 3.0 }],
      ] },
      { line: 's5-gs-4', hold: 5.4, do: [
        ['L-1.2', { k: 'goose', line: 's5-gs-4' }],
        ['L+0.4', { k: 'run', op: 'bill-sync' }],
        ['L+1.0', { k: 'highlight', target: 'step-BUDGET', dur: 1.2 }],
        ['L+2.2', { k: 'highlight', target: 'step-GOAL_FIRST_RUN', dur: 1.2 }],
        ['L+3.4', { k: 'highlight', target: 'step-INVEST', dur: 1.4 }],
        ['L+4.8', { k: 'highlight', target: 'step-BILL_SYNC', dur: 1.6 }],
      ] },
    ],
  },
  {
    id: 'security', scene: 'security', title: '安全攻防快回放', target: [262, 280],
    beats: [
      { line: 's6-nr-1', lead: 0.6, hold: 0.2, min: 17.6, do: [
        [0, { k: 'scene', scene: 'security' }],
        [0.4, { k: 'run', op: 'sec-1' }],
        [4.2, { k: 'run', op: 'sec-2' }],
        [6.4, { k: 'run', op: 'sec-3' }],
        [8.4, { k: 'cursor', to: 'sec-lookup', dur: 0.6 }],
        [9.4, { k: 'click', target: 'sec-lookup' }],
      ] },
    ],
  },
  {
    id: 'ending', scene: 'ending', title: '收尾 · 真正长大的，是用户', target: [280, 300],
    beats: [
      { line: 's7-xz-1', lead: 1.6, hold: 0.6, do: [[0, { k: 'scene', scene: 'ending' }], ['L-0.6', { k: 'user', line: 's7-xz-1', mode: 'voice' }]] },
      { line: 's7-nr-1', lead: 0.2, hold: 0.3 },
      { line: 's7-nr-2', lead: 0.1, hold: 1.0, do: [['L-0.2', { k: 'overlay', kind: 'final' }]] },
    ],
  },
];
