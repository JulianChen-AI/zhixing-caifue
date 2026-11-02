'use client';
// Business cards for each scene. Everything shown is read from the DemoSandbox state.
import {
  ArrowRight, Ban, Bell, CircleCheck, Compass, CreditCard, Database, ExternalLink, Hourglass, Lock, Map as MapIcon,
  Mic, Receipt, Route, Scale, Search, ShieldAlert, ShieldCheck, Snowflake, TriangleAlert, Users, Wallet,
} from 'lucide-react';
import { ANOMALY_TX, BILL_TXS, PAYDAY, PRODUCT, RISK_PROFILE, SUBSCRIPTIONS } from '@/lib/demo/fixtures';
import type { Card as CardRef } from '@/lib/demo/runtime';
import { Appear, Btn, Card, Chip, Row, Tag, flashOn, useDemo, yuan } from './kit';

const short = (hash?: string) => hash ? `${hash.slice(0, 8)}…` : '—';

export function BusinessCard({ card }: { card: CardRef }) {
  const { t, view } = useDemo();
  const sb = view.sb;
  const at = card.at;
  switch (card.kind) {
    case 'done':
      return <Appear at={at} className="done-line"><CircleCheck size={18} /> {card.summary}</Appear>;

    // ---------------- Intro ----------------
    case 'intro-salary':
      return <Card at={at} title="工资到账" icon={<Wallet size={20} />} badge={<Tag kind="fact">事实 · 沙箱已入账</Tag>}>
        <div className="big-amount">+{yuan(PAYDAY.salary_fen)}<small>元</small></div>
        <div className="muted-line">合成账户 · 2026-10-28 09:00 · 尾号 0921 同名账户另行管理</div>
      </Card>;
    case 'intro-map':
      return <Card at={at} title="本月安排 · 跑腿地图" icon={<MapIcon size={20} />} badge={<Chip tone="wait">尚未执行</Chip>}>
        <TaskMap compact />
        <div className="card-actions"><Btn id="intro-basis" kind="ghost" done={!!view.flash['intro-basis']}>查看数据依据</Btn></div>
      </Card>;
    case 'intro-basis':
      return <Card at={at} title="数据依据" icon={<Database size={20} />} badge={<Chip tone="info">先看依据，再决定</Chip>}>
        <BasisRows />
      </Card>;

    // ---------------- Transfer ----------------
    case 'tr-candidates': {
      const chosen = view.selected;
      return <Card at={at} id="tr-candidates" title="找到 3 位“张三”" icon={<Search size={20} />} badge={<Chip tone={chosen ? 'ok' : 'wait'}>{chosen ? '已由你选择' : '无默认选中 · 请你选择'}</Chip>}>
        <div className="cand-list">
          {view.candidates!.map((c, i) => (
            <Appear key={c.contact_id} at={at + 0.15 + i * 0.12}>
              <div className={`cand ${chosen === c.contact_id ? 'is-on' : ''}`} data-demo={`cand-${c.contact_id}`}>
                <span className="cand-radio" />
                <span className="cand-name">张三</span>
                <span className="cand-rel">{c.relation}</span>
                <span className="cand-tail">尾号 {c.account_tail}</span>
              </div>
            </Appear>
          ))}
        </div>
        <div className="note-line">联系人备注只用于辨认，不代替账户核验</div>
      </Card>;
    }
    case 'tr-confirm': {
      const tr = view.transfer!;
      const draft = sb.drafts.get(tr.draft_id)!;
      const voiceAt = tr.voiceNotice;
      const done = !!tr.confirmation_id;
      return <Card at={at} title="转账确认页" icon={<ShieldCheck size={20} />} badge={<Chip tone={done ? 'ok' : 'wait'}>{done ? '已手动确认' : '待你手动确认'}</Chip>}>
        <Row k="收款人" v={<>张三 · 羽毛球社 <b>尾号 7291</b></>} />
        <Row k="金额" v={<b className="num">120.00 元</b>} />
        <Row k="用途" v="球场费" />
        <Row k="付款账户余额" v={<span className="num">{yuan(tr.balanceBefore)} 元</span>} />
        <Row k="载荷哈希" v={<code>{short(draft.payload_hash)}</code>} tag={<Tag kind="calc">绑定本页内容</Tag>} />
        {voiceAt !== undefined && t >= voiceAt && <Appear at={voiceAt} className="voice-notice" id="voice-notice">
          <Mic size={18} /><div><b>语音“确认”不构成支付授权</b><span>确认凭证 {tr.voiceSnapshot!.confirmations} · 订单 {tr.voiceSnapshot!.orders} 笔 · 余额 {yuan(tr.voiceSnapshot!.balance)} 元未变 · 仍需在本页手动确认</span></div>
        </Appear>}
        <div className="card-actions"><Btn id="tr-confirm" done={done}>{done ? '已确认' : '手动确认并认证'}</Btn></div>
      </Card>;
    }
    case 'auth': {
      const a = view.auth;
      if (!a) return null;
      const title = { transfer: '转账', freeze: '临时冻结', rule: '目标储蓄规则（强认证）', invest: '定投计划' }[a.for];
      return <Card at={at} className="auth-sheet" title={`演示认证 · ${title}`} icon={<Lock size={20} />} badge={<Chip tone="info">模拟认证</Chip>}>
        <div className="auth-body">
          <div className="auth-dots">{Array.from({ length: 6 }, (_, i) => <span key={i} />)}</div>
          <p>演示环境不采集真实密码或验证码；对话中也不会索要认证凭证。</p>
        </div>
        <div className="card-actions"><Btn id="auth-ok">完成演示认证</Btn></div>
      </Card>;
    }
    case 'tr-receipt': {
      const order = view.transfer!.order!;
      return <Card at={at} id="tr-receipt" title="转账回执" icon={<Receipt size={20} />} badge={<Tag kind="sim">模拟回执</Tag>}>
        <div className="receipt-status ok"><CircleCheck size={22} /> 已完成 <small>SUCCESS · 沙箱</small></div>
        <Row k="订单号" v={<code>{order.order_id}</code>} tag={<span className="muted">本次唯一订单</span>} />
        <Row k="金额 / 收款人" v="120.00 元 → 张三（羽毛球社）尾号 7291" />
        <Row k="余额" v={<span className="num">{yuan(view.transfer!.balanceBefore)} → <b>{yuan(sb.balance_fen)}</b> 元</span>} />
        <Row k="确认方式" v="manual_click ＋ 演示认证" tag={<span className="muted">语音不计入</span>} />
      </Card>;
    }
    case 'aa-calc': {
      const calcs = view.aaCalcs!;
      const v1 = calcs[0], v2 = calcs[1];
      const v2At = view.flash['aa-v2'];
      const created = !!view.aa?.created;
      return <Card at={at} title="AA 分摊计算" icon={<Users size={20} />} badge={<Tag kind="calc" />}>
        <div className={`aa-v1 ${v2 ? 'is-void' : ''}`}>
          <span>草稿 v1 · 均分</span><span className="num">360 ÷ 6 = 60.00 元/人</span>
          {v2 && <Chip tone="void">已作废</Chip>}
        </div>
        {v2 && v2At !== undefined && <Appear at={v2At}>
          <div className="aa-rule">草稿 v2 · 按你的改口重算：餐费 300 元六人均分，饮料 60 元三人均分</div>
          <table className="aa-table">
            <thead><tr><th>成员</th><th>明细</th><th className="r">应付</th></tr></thead>
            <tbody>{v2.shares.map((s, i) => <tr key={s.member} style={{ opacity: Math.min(1, Math.max(0, (t - v2At - 0.15 - i * 0.08) / 0.25)) }}>
              <td>{s.member}{s.member === v2.payer && <em>垫付人</em>}</td><td className="muted">{s.detail.join(' ＋ ')}</td><td className="r num">{yuan(s.amount_fen)}</td>
            </tr>)}</tbody>
          </table>
          <div className="aa-assert" data-demo="aa-assert">
            <span><CircleCheck size={16} /> 六人合计 {yuan(v2.shares.reduce((a, s) => a + s.amount_fen, 0))} ＝ 总额 {yuan(v2.total_fen)}</span>
            <span><CircleCheck size={16} /> 其他五人应收 <b>{yuan(v2.receivable_fen)}</b> 元</span>
          </div>
          <div className="card-actions"><Btn id="aa-confirm" done={created}>{created ? '已发起收款' : '手动确认名单与分摊'}</Btn></div>
        </Appear>}
        {!v2 && v1 && <div className="muted-line">等待你的补充……</div>}
      </Card>;
    }
    case 'aa-status': {
      const s = sb.aaStatus();
      const calc = view.aaCalcs!.at(-1)!;
      const remind = view.aa!.remind!;
      const sent = !!remind.sent;
      const pct = s.received_fen / calc.receivable_fen;
      return <Card at={at} title="AA 收款状态" icon={<Users size={20} />} badge={<Chip tone="pending">部分已收</Chip>}>
        <div className="aa-split" data-demo="aa-split">
          <div><small>已收</small><b className="num ok">{yuan(s.received_fen)}</b></div>
          <div><small>待收</small><b className="num pending">{yuan(s.pending_fen)}</b></div>
          <div><small>应收</small><b className="num">{yuan(calc.receivable_fen)}</b></div>
        </div>
        <div className="bar"><span style={{ width: `${pct * 100}%` }} /></div>
        <table className="aa-table status" data-demo="aa-columns">
          <thead><tr><th>成员</th><th className="r">应付</th><th>到账状态</th><th>提醒发送状态</th></tr></thead>
          <tbody>{calc.shares.filter(x => x.member !== calc.payer).map(x => {
            const m = s.members[x.member];
            return <tr key={x.member}>
              <td>{x.member}</td><td className="r num">{yuan(x.amount_fen)}</td>
              <td>{m.payment === 'PAID' ? <Chip tone="ok">已到账</Chip> : <Chip tone="wait">未到账</Chip>}</td>
              <td>{m.reminder === 'SENT' ? <Chip tone="info">已发送 · 模拟</Chip> : m.payment === 'PAID' ? <span className="muted">无需提醒</span> : <span className="muted">未发送</span>}</td>
            </tr>;
          })}</tbody>
        </table>
        <div className="card-actions"><Btn id="aa-remind" kind={sent ? 'ghost' : 'primary'} done={sent}>{sent ? '提醒已发送 · 到账仍以收款为准' : <><Bell size={16} /> 提醒待付的 {(remind.payload.members as string[]).join('、')}</>}</Btn></div>
        <div className="note-line">提醒前重查付款状态，已付者不再提醒；“已发送”不等于“已到账”。这笔 AA 与 120 元转账互不混记。</div>
      </Card>;
    }

    // ---------------- Bills ----------------
    case 'bill-scope': {
      const b = view.bill!.data;
      return <Card at={at} id="bill-scope" title="本月账单 · 数据范围" icon={<Database size={20} />} badge={<Chip tone="info">先讲范围，再讲结论</Chip>}>
        <div className="scope-grid">
          <div><small>已授权账户</small><b>{b.scope.included.join('、')}</b></div>
          <div><small>统计周期</small><b>{b.scope.period}</b></div>
          <div data-demo="bill-missing"><small>未接入 · 不在统计内</small><b className="pending">{b.scope.excluded.join('、')}</b></div>
        </div>
      </Card>;
    }
    case 'bill-coffee': {
      const b = view.bill!.data;
      return <Card at={at} title="支出分类" icon={<Scale size={20} />}>
        <div className="evidence">
          <div className="ev"><Tag kind="fact" /><span>该月有 <b>{b.coffee.count} 笔</b>、合计 <b>{yuan(b.coffee.amount_fen)} 元</b> 的相关交易</span></div>
          <div className="ev" data-demo="tag-infer"><Tag kind="infer" /><span>商户映射推断为“咖啡类”，比上月多 {b.coffee.mom_count_delta} 笔；<b>不代表实际杯数或具体商品</b></span></div>
          <div className="ev"><Tag kind="suggest" /><span>{b.suggestion}</span></div>
        </div>
      </Card>;
    }
    case 'bill-tx': {
      const tx = sb.txs.find(x => x.tx_id === 'TX-PRINT-018')!;
      const corrected = view.corrected;
      const open = view.correctOpen;
      return <Card at={at} title="明细 · 可纠正分类" icon={<Receipt size={20} />}>
        <div className="tx-list">
          {BILL_TXS.filter(x => x.month === 'this' && ['TX-CF-07', 'TX-CANT-021'].includes(x.tx_id)).map(x => (
            <div key={x.tx_id} className="tx"><span className="muted">{x.date}</span><span>{x.merchant}</span><span className="num">{yuan(x.amount_fen)}</span><span className="tx-cat">{x.category}{x.inferred && '（推断）'}</span></div>
          ))}
          <div className={`tx is-focus ${flashOn(t, view.flash['tx-corrected'], 1.4) ? 'is-flash' : ''}`}>
            <span className="muted">{tx.date}</span><span>{tx.merchant}</span><span className="num">{yuan(tx.amount_fen)}</span>
            <span className="tx-cat">{corrected ? <><s>餐饮（推断）</s> <b>学习/打印</b> <Tag kind="user">你的纠正</Tag></> : tx.category}</span>
            {!corrected && <Btn id="tx-correct" kind="ghost">纠正分类</Btn>}
          </div>
          {open && <div className="cat-menu" style={{ opacity: 1 }}>
            {['餐饮', '学习/打印', '日用', '交通'].map(c => <span key={c} className="cat-opt" data-demo={c === '学习/打印' ? 'cat-study' : undefined}>{c}</span>)}
          </div>}
          {corrected && <div className="note-line" data-demo="tx-scope">默认只改这一笔 · 未对同类商户批量改历史 · 原始流水不变</div>}
        </div>
      </Card>;
    }
    case 'fed': {
      const f = sb.federatedStatus();
      const q = f.queue[0];
      return <Card at={at} title="纠错知识 · 数据最小化" icon={<ShieldCheck size={20} />} badge={<Chip tone="info">思想级模拟｜未进行真实联邦训练</Chip>}>
        <div className="fed">
          <div className="fed-col" data-demo="fed-local"><small>本地保留（不上传）</small>
            <div className="fed-item local">原始语句 · 金额 18.00 · 时间 10-18 · 身份</div>
            <div className="fed-x"><Ban size={18} /> 不进入共享队列</div>
          </div>
          <ArrowRight className="fed-arrow" size={22} />
          <div className="fed-col" data-demo="fed-queue"><small>待聚合队列（仅候选）</small>
            <div className="fed-item">纠正标签：{q?.label_from} → {q?.label_to}</div>
            <div className="fed-item muted">贡献已裁剪 · 访问控制开启</div>
          </div>
        </div>
        <div className="fed-gate" data-demo="fed-gate">
          <span>人数门槛 <b>k = {f.k} / {f.threshold}</b></span><span>差分隐私预算 <b>未授予</b></span><span><Chip tone="wait">未发布</Chip></span>
        </div>
        <div className="note-line">k≥20 只是最低门槛，不等于匿名安全；还需隐私预算与独立评审。不展示任何同龄人统计。</div>
      </Card>;
    }
    case 'sub-radar': {
      const paths = view.subPaths || {};
      return <Card at={at} title="持续扣费雷达" icon={<Route size={20} />} badge={<Tag kind="infer">账单线索 · 疑似订阅</Tag>}>
        {SUBSCRIPTIONS.map(s => (
          <div key={s.subscription_id} className="sub-row">
            <div className="sub-main"><b>{s.name}</b><span className="num">{yuan(s.amount_fen)} 元/月</span>
              <span className="muted">{s.channel === 'BANK_DIRECT' ? `连续 ${s.months} 个月 · 银行代扣通道` : '外部通道（第三方支付）'}</span></div>
            {paths[s.subscription_id] === 'bank' ? <Chip tone="info">路径：银行通道解约（需你确认）</Chip>
              : paths[s.subscription_id] === 'external' ? <Chip tone="muted" id="sub-external"><ExternalLink size={14} /> 仅能前往官方通道 · 未实现跳转</Chip>
              : <Btn id={`sub-stop-${s.subscription_id}`} kind="ghost">不再使用 · 看处理路径</Btn>}
          </div>
        ))}
      </Card>;
    }
    case 'sub-confirm':
      return <Card at={at} title="确认：解除星幕视频的银行代扣授权" icon={<ShieldCheck size={20} />} badge={<Chip tone="wait">待你手动确认</Chip>}>
        <Row k="会做什么" v="解除本行代扣通道对该商户的授权" />
        <Row k="不会做什么" v="不等于商户退订，不退还历史扣款" />
        <Row k="之后" v="原应扣日后核验是否未再扣款" />
        <div className="card-actions"><Btn id="sub-confirm">手动确认解除</Btn></div>
      </Card>;
    case 'sub-status': {
      const s = sb.subscriptions['SUB-VIDEO-25'];
      const states: [string, string, string, 'ok' | 'wait' | 'muted' | 'pending'][] = [
        ['sub-state-bank', '银行通道授权', s.bank_channel_release === 'RELEASED_SIMULATED' ? '已解除（模拟回执）' : s.bank_channel_release, 'ok'],
        ['sub-state-merchant', '商户退订', '未确认', 'wait'],
        ['sub-state-refund', '退款', '未发起', 'muted'],
        ['sub-state-check', '原应扣日后核验', '待进行', 'pending'],
      ];
      return <Card at={at} title="星幕视频 · 四个状态分开记" icon={<Receipt size={20} />} badge={<code>{view.sub?.order_id}</code>}>
        <div className="four">{states.map(([id, k, v, tone]) => <div key={id} className="four-cell" data-demo={id}><small>{k}</small><Chip tone={tone}>{v}</Chip></div>)}</div>
        <div className="sub-row ext"><div className="sub-main"><b>云听音乐</b><span className="muted">外部通道</span></div><Chip tone="muted">前往官方通道 · 待办 · 不显示“已取消”</Chip></div>
      </Card>;
    }

    // ---------------- Cards ----------------
    case 'anomaly': {
      const a = view.anomaly!.data;
      const r = a.reviews;
      const notMe = view.flash['not-me'];
      return <Card at={at} title="需要核实的交易" icon={<TriangleAlert size={20} />} badge={<Chip tone="info">多 Agent 思想级模拟｜异构审查，非自主资金裁决</Chip>}>
        <div className="anom-tx"><span>{ANOMALY_TX.time}</span><span>{ANOMALY_TX.city}</span><span className="num">{yuan(ANOMALY_TX.amount_fen)} 元</span><span>首次商户</span></div>
        <div className="reviews" data-demo="review-split">
          {[
            [r.data_review.role, '只读交易事实', r.data_review.facts.join(' · '), r.data_review.position, 'fact'],
            [r.pattern_review.role, '与历史模式比较', r.pattern_review.inference, r.pattern_review.position, 'infer'],
            [r.policy_review.role, '规则边界', r.policy_review.rule, r.policy_review.position, 'rule'],
          ].map(([role, sub, body, pos, kind], i) => (
            <Appear key={role} at={at + 0.6 + i * 0.55} className="review">
              <div className="review-head"><b>{role}</b><Tag kind={kind as 'fact'} /></div>
              <small>{sub}</small><p>{body}</p><Chip tone={i === 0 ? 'muted' : 'wait'}>{pos}</Chip>
            </Appear>
          ))}
        </div>
        <Appear at={at + 2.4} className="verdict" id="anomaly-verdict">
          <Scale size={18} /><div><b>确定性规则输出：待核实</b><span>保留三方分歧 · 不是投票 · 不能认定盗刷 · 不自动锁卡</span></div>
        </Appear>
        <Appear at={at + 2.8} className="card-actions wrap">
          <Btn id="anomaly-me" kind="ghost">是我本人</Btn>
          <Btn id="anomaly-not-me" kind={notMe ? 'ghost' : 'danger'} done={!!notMe}>不是我</Btn>
          <Btn id="anomaly-detail" kind="ghost">查看明细</Btn>
          <Btn id="anomaly-official" kind="ghost">联系官方</Btn>
        </Appear>
      </Card>;
    }
    case 'freeze-confirm': {
      const done = !!view.auth || !!view.freeze?.order_id;
      return <Card at={at} title="卡片管理 · 临时冻结确认" icon={<CreditCard size={20} />} badge={<Chip tone={done ? 'ok' : 'wait'}>{done ? '已手动确认' : '待你手动确认'}</Chip>}>
        <div data-demo="freeze-facts">
          <Row k="卡片" v={<b>借记卡 尾号 6688</b>} />
          <Row k="操作" v="临时冻结（可自行解冻）" />
          <Row k="冻结范围" v="具体限制以卡产品与通道回执为准" />
          <Row k="后果" v="冻结期间该卡交易将被拒绝；已发生的交易需另行核实" />
          <Row k="正式挂失" v="需另行办理，本操作不等于挂失" />
        </div>
        <div className="card-actions"><Btn id="freeze-confirm" kind="danger" done={done}>{done ? '已确认' : '手动确认并认证'}</Btn></div>
      </Card>;
    }
    case 'freeze-receipt':
      return <Card at={at} title="临时冻结回执" icon={<Snowflake size={20} />} badge={<Tag kind="sim">模拟回执</Tag>}>
        <div className="receipt-status ok"><ShieldCheck size={22} /> 临时冻结已生效 <small>FROZEN_SIMULATED</small></div>
        <Row k="订单号" v={<code>{view.freeze?.order_id}</code>} />
        <Row k="卡片" v="尾号 6688 · 状态以通道回执为准" />
        <div className="warn-line"><ShieldAlert size={16} /> 临时冻结 ≠ 正式挂失；不承诺所有代扣中断，不触发提额</div>
      </Card>;

    // ---------------- Payday ----------------
    case 'pd-map':
      return <Card at={at} title="本月安排 · 跑腿地图" icon={<MapIcon size={20} />} badge={Object.values(view.steps || {}).some(s => s.tone !== 'wait' && s.label !== '数据范围')
        ? <Chip tone="info">每一步独立确认 · 独立回执</Chip> : <Chip tone="wait" id="pd-not-executed">尚未执行任何付款或申购</Chip>}>
        <TaskMap />
      </Card>;
    case 'pd-basis':
      return <Card at={at} title="资金依据" icon={<Database size={20} />} badge={<Chip tone="info">每项都能修改或删除</Chip>}>
        <BasisRows withBudget />
        <div className="card-actions"><Btn id="budget-confirm" kind="ghost" done={view.budgetConfirmed}>{view.budgetConfirmed ? '聚餐预算草稿已确认 · 未付款' : '确认聚餐预算草稿'}</Btn></div>
      </Card>;
    case 'rule-confirm': {
      const p = view.rule!.payload;
      return <Card at={at} title="规则确认页 · 目标储蓄" icon={<ShieldCheck size={20} />} badge={<Chip tone="wait">创建需强认证</Chip>}>
        <Row k="收款账户" v={<>本人同名目标账户 <b>尾号 {PAYDAY.goal_account.tail}</b></>} />
        <div className="limits" data-demo="rule-limits">
          <div><small>单笔</small><b className="num">{yuan(p.amount_fen as number, 0)}</b></div>
          <div><small>次数</small><b className="num">{p.max_executions as number} 次</b></div>
          <div><small>累计上限</small><b className="num">{yuan(p.cumulative_cap_fen as number, 0)}</b></div>
          <div><small>期限</small><b className="num">90 天</b></div>
        </div>
        <div className="note-line">到期不自动续期 · 随时暂停 · 修改账户或金额将作废旧授权并重新确认 · 首次执行前再确认</div>
        <div className="card-actions"><Btn id="rule-confirm">手动确认并强认证</Btn></div>
      </Card>;
    }
    case 'rule-receipt':
      return <Card at={at} title="规则已创建" icon={<Receipt size={20} />} badge={<Tag kind="sim">模拟回执</Tag>}>
        <Row k="规则号" v={<code>{view.rule?.order_id}</code>} tag={<span className="muted">v1 · 90 天</span>} />
        {view.rule?.firstRun?.order_id
          ? <Row k="首跑" v={<><Chip tone="ok">首跑已确认 · 已划转 400.00（模拟回执）</Chip></>} tag={<code>{view.rule.firstRun.order_id}</code>} />
          : <Row k="首跑" v={<Chip tone="wait">待你再次确认</Chip>} />}
      </Card>;
    case 'firstrun-confirm':
      return <Card at={at} title="首跑确认 · 第 1 / 3 次" icon={<ShieldCheck size={20} />} badge={<Chip tone="wait">待你手动确认</Chip>}>
        <Row k="本次" v="400.00 元 → 本人同名目标账户 尾号 0921" />
        <div className="card-actions"><Btn id="firstrun-confirm">确认首次执行</Btn></div>
      </Card>;
    case 'invest': {
      const match = view.investMatch!;
      return <Card at={at} title="了解理财 · 每月 200 元" icon={<Compass size={20} />} badge={<Chip tone="info">只提供信息 · 决定在你</Chip>}>
        <div className="edu" data-demo="edu-entry"><span>投教小课（自愿 · 可跳过）</span><span className="muted">不是购买门槛</span></div>
        <div className="cr" data-demo="cr-split">
          <div><small>正式测评 · 客户风险承受能力</small><b>C2</b><span className="muted">{RISK_PROFILE.questionnaire}<br />{RISK_PROFILE.assessed_at} 完成 · 有效至 {RISK_PROFILE.valid_until}</span></div>
          <div><small>产品风险等级</small><b>R2</b><span className="muted">{PRODUCT.name}<br />非存款 · 不保本</span></div>
          <div className="cr-match"><small>机构规则匹配结果</small><Chip tone="ok">{match.result === 'MATCH' ? '匹配（模拟）' : match.result}</Chip><span className="muted">{match.rule} · 非模型判断</span></div>
        </div>
      </Card>;
    }
    case 'invest-disclosure': {
      const p = view.invest?.payload || {};
      const ack = view.invest?.ack;
      return <Card at={at} title="费用、风险与计划" icon={<TriangleAlert size={20} />} badge={<Chip tone="wait">需你独立授权</Chip>}>
        <div className="fees">
          <span>申购费 {PRODUCT.fee.subscription}</span><span>赎回费 {PRODUCT.fee.redemption}</span><span>管理费 {PRODUCT.fee.management_per_year}/年</span>
          <span>托管费 {PRODUCT.fee.custody_per_year}/年</span><span>销售服务费 {PRODUCT.fee.sales_service_per_year}/年</span>
        </div>
        <div className="risk-box" data-demo="disclosure-risk">
          <div><b>可能亏损</b>：合成样本历史最大回撤 {PRODUCT.sample_max_drawdown}</div>
          <div><b>流动性</b>：{PRODUCT.liquidity}</div>
          <div><b>{PRODUCT.disclosure}</b></div>
        </div>
        <Row k="定投计划" v={<span className="num">每月 {yuan(p.amount_fen as number, 0)} · {p.times as number} 次 · 累计上限 {yuan(p.cumulative_cap_fen as number, 0)} · 90 天</span>} />
        <div className={`ack ${ack ? 'is-on' : ''}`} data-demo="risk-ack"><span className="box">{ack && <CircleCheck size={18} />}</span>我已了解费用、可能亏损和非实时到账，自行决定是否继续</div>
        <div className="card-actions"><Btn id="invest-confirm" disabled={!ack}>手动确认并认证</Btn></div>
      </Card>;
    }
    case 'invest-receipt':
      return <Card at={at} title="定投申请回执" icon={<Hourglass size={20} />} badge={<Tag kind="sim">模拟回执</Tag>}>
        <div className="receipt-status pending"><Hourglass size={20} /> 申请已受理 · 份额待确认 <small>ACCEPTED_SHARES_PENDING</small></div>
        <Row k="订单号" v={<code>{view.invest?.order_id}</code>} tag={<span className="muted">受理 ≠ 成交</span>} />
        <Row k="收益" v={<span className="muted">不展示（尚未确认份额）</span>} />
      </Card>;

    // ---------------- Security ----------------
    default:
      return null;
  }
}

/** The payday task chain: one station per step, each with its own status. */
export function TaskMap({ compact }: { compact?: boolean }) {
  const { t, view } = useDemo();
  const steps = view.steps;
  if (!steps) return null;
  return <div className={`taskmap ${compact ? 'compact' : ''}`} data-demo="pd-steps">
    {Object.entries(steps).map(([id, s], i) => {
      const flash = flashOn(t, view.flash[`step-${id}`], 1.0);
      const write = ['GOAL_RULE', 'GOAL_FIRST_RUN', 'INVEST'].includes(id) || id === 'BUDGET';
      return <div key={id} className={`station tone-${s.tone} ${flash ? 'is-flash' : ''}`} data-demo={`step-${id}`}>
        <span className="station-dot">{i + 1}</span>
        <div className="station-body"><b>{s.label}</b><span>{s.status}</span></div>
        {write && !compact && <span className="booth" title="确认岗亭"><Lock size={13} /> 确认岗亭</span>}
      </div>;
    })}
  </div>;
}

function BasisRows({ withBudget }: { withBudget?: boolean }) {
  const { view } = useDemo();
  const plan = view.plan?.data;
  if (!plan) return null;
  return <div className="basis">
    <Row k="工资到账" v={<span className="num">8,000.00</span>} tag={<Tag kind="fact">事实 · 沙箱入账</Tag>} />
    {plan.basis.map(b => <Row key={b.label} k={`− ${b.label}`} v={<span className="num">{yuan(b.amount_fen)}</span>} tag={<Tag kind={b.source === '用户登记' ? 'user' : 'rule'} />} />)}
    <Row id="pd-available" strong k="＝ 可用结余" v={<span className="num">{yuan(plan.available_fen)}</span>} tag={<Tag kind="calc" />} />
    {withBudget && <Row id="pd-budget" k="新增 · 家庭聚餐" v={<span className="num">400.00</span>} tag={<Tag kind="draft">预算草稿 · 不付款 · 不冻结</Tag>} />}
    <div className="note-line">可用结余不等于“全部适合投资的钱”</div>
  </div>;
}
