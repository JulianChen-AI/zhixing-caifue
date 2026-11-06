'use client';
import {RISK_QUESTIONS} from '@/lib/workflows/questionnaire';
import {FlowSelect,FlowMulti} from './flow-select';
import {InvestRisk,InvestDisclosure} from './desk';
import {AaCalculation,AaStatus,CardHead,ReceiptStatus,Row,SubscriptionStates} from './card-kit';
import {CompareCard,ProductsCard} from './card-viz-more';
import {SubscriptionTile} from './card-viz';
import {BillDetail,SpendCharts,businessViz,Columns,FollowUp,GuideSteps,Kpis,LevelScale,ProcessSteps,ReviewViz} from './card-viz';
import {dailyNet,writeSteps} from '@/lib/ui/viz';

import { Fragment, useContext, useState } from 'react';
import type { BankAction, BankState } from '@/lib/bank/types';
import { currentWorkflow } from '@/lib/workflows/current';
import { USER_FUNCTIONS, UNSUPPORTED_FUNCTIONS } from '@/lib/workflows/catalog';
import { ACTIONS, isWrite, needsAuth } from '@/lib/workflows/write-kind';
import { choices, FIELDS, LABELS, requiredFields } from '@/lib/workflows/fields';
import type { FlowTask, Params, WorkflowCommand } from '@/lib/workflows/types';
import { ACTION_LABELS as actionLabel } from '@/lib/workflows/review';
import { businessTitle, fieldLabels, resultMessage, unavailableFields, userMessage, workflowMessage } from '@/lib/ui/presentation';
import { changedFields, localDate, reviewEntries, taskIdentity } from '@/lib/ui/business';
import { CancelTask } from './cancel-task';
import { FraudStop, SuitabilityStop } from './stop-cards';
import { cardHead, reviewNotes } from '@/lib/ui/cards';
import { contactsOf } from '@/lib/bank/recipients';

const statusLabel:Record<string,string>={collecting:'补充信息',review:'待确认',authenticate:'验证身份',complete:'办理结果',cancelled:'未办理',blocked:'暂无法办理',unsupported:'暂不可用',external:'待你处理'};
const resultLabels:Record<string,string>={grossExpenses:'支出合计（退款前）',netExpenses:'净支出（已扣退款）',expenseCount:'消费笔数',refundCount:'退款笔数',countBasis:'笔数口径',autoSave:'自动转存',monthlyAmount:'每月计划金额',reservedCost:'对应成本',protected:'保护类代扣',confirmed:'条目已确认',issuer:'发卡机构',replacementId:'补卡申请',lostAt:'挂失时间',settledAt:'结算时间',relatedId:'关联业务',originalId:'原交易',suspectedDuplicate:'疑似重复',id:'编号',taskId:'任务',functionId:'功能',title:'名称',name:'名称',tail:'尾号',accountId:'账户',amount:'金额',balance:'余额',target:'目标金额',remaining:'剩余目标',progress:'完成比例',value:'市值',cost:'成本',profit:'收益',period:'期间',category:'类别',merchant:'商户',date:'日期',kind:'类型',status:'状态',restriction:'限制类型',limit:'交易限额',channel:'通道',cycle:'周期',nextChargeAt:'下次扣款日',benefitUntil:'权益截止',coverage:'数据范围',source:'来源',asOf:'数据时间',basis:'统计口径',expenses:'净支出',refunds:'退款',income:'收入',count:'笔数',current:'本期',baseline:'比较期',summary:'统计',notice:'说明',message:'说明',guide:'操作指引',assumption:'计算假设',total:'总额',periodCount:'期数',subscriptions:'订阅',transactions:'交易明细',cancellations:'取消记录',actual:'实际记录',projectedMonthlyReduction:'预计每月少支出',risk:'产品风险级别',feeRate:'费率',price:'单位净值',type:'产品类型',liquidity:'流动性',synthetic:'数据来源',level:'风险级别',validUntil:'有效期',answers:'答案',direction:'资金方向',moved:'移动金额',calendar:'扣款日历',protection:'保护范围',explanation:'说明',canSelfUnlock:'是否可自助解除',createdAt:'创建时间',productId:'产品',holdingId:'持仓',goalId:'目标',schedule:'周期',authorizedAt:'授权时间',delivery:'交付范围',execution:'执行范围',participants:'参与者',budgets:'预算',spending:'当前支出',content:'内容',topic:'主题',assessmentChanged:'是否改变测评',bindings:'绑定项',sourceType:'来源',narrative:'叙事',peerComparison:'群体参照'};
const values:Record<string,string>={daily:'日常账户',savings:'储蓄账户',active:'正常/已开启',frozen:'临时冻结',lost:'正式挂失',restricted:'受限制',none:'无',risk:'保护性风控',judicial:'司法限制',pending:'已受理，待确认',settled:'已结算',cancelled:'已取消',bank_cancelled:'银行协议已解除',external_pending:'外部待办，尚未核验',bank:'银行直连',platform:'外部平台',monthly:'每月',yearly:'每年',received:'已收件，待审核',requested:'已申请',subscribe:'申购',redeem:'赎回',expense:'支出',refund:'退款',internal_transfer:'自有账户间转移',investment:'理财资金',deposit:'存入',withdraw:'取出',paused:'已暂停',awaiting_participants:'等待参与者确认',manually_reconciled:'用户手动核销',activated:'已激活'};
Object.assign(resultLabels,{reading:'字段取值',deadline:'截止日期',months:'估算期数',planBasis:'月供重算口径',cancellationPolicy:'撤单规则',cancelUntil:'撤单截止时间',periodType:'报告类型',periodSource:'期间来源',periodNotice:'期间说明',comparison:'同口径比较',baselinePeriod:'比较期间',changePercent:'变化幅度',unavailableReason:'无法比较的原因',insights:'可复核洞察',rule:'规则',text:'结论',evidence:'计算依据',label:'项目',reason:'说明',use:'适用用途',nextStep:'下一步',classificationSource:'分类依据',confidence:'分类置信度',needsCategoryConfirmation:'是否待确认类别',businessStage:'业务阶段',estimatedArrivalAt:'预计到账日',calendarNotice:'工作日口径',feeNotice:'费用说明',fees:'费用分项',rate:'费率',worstCase:'最坏情形',riskNotice:'风险提示',differences:'差异',missing:'缺失字段',comparedFields:'比较字段',field:'字段',values:'各产品取值',productName:'产品名称',managementFee:'管理费',custodyFee:'托管费',recommendedPath:'建议路径',recommendedPaths:'可选路径',paths:'办理路径',purpose:'用途',readOnly:'只读指引',materials:'准备材料',officialSteps:'官方核实步骤',responsibilityNotice:'责任说明',nextActions:'后续操作',merchantSubscriptionState:'商户订阅状态',bankAgreementState:'银行协议状态',chargeState:'扣款状态',executionState:'执行状态',executionNotice:'执行范围',netAmount:'预计净额',fee:'费用',changeAmount:'净支出变化',baselineNetExpenses:'比较期净支出',categoryBreakdown:'分类净支出',feeRate:'交易费率'});
Object.assign(values,{system:'系统明确用途','merchant-map':'商户映射','user-rule':'用户确认的未来规则','user-confirmed':'用户确认',month:'月报',year:'年报','requested-year':'用户指定年份','requested-month':'用户指定月份','latest-transaction-month':'最新流水月份','current-month':'当前月份',unknown:'未知',accepted:'已受理，待确认',shares_confirmed:'份额已确认',funds_arrived:'资金已到账',bank_mandate_stopped:'银行代扣已停止',unverified:'未核验',scheduled_not_connected:'已保存',transferred:'已执行',debit:'借记卡',credit:'信用卡',virtual:'虚拟卡'});
Object.assign(resultLabels,{assessmentState:'测评记录状态',profile:'测评结果'});
Object.assign(resultLabels,{orders:'订单'});
Object.assign(values,{not_found:'当前会话暂无测评记录',valid:'有效',expired:'已过期'});
const moneyKeys=new Set(['amount','balance','target','remaining','value','cost','profit','limit','expenses','grossExpenses','netExpenses','refunds','income','total','projectedMonthlyReduction','moved','monthlyAmount','reservedCost','fee','netAmount','changeAmount','baselineNetExpenses']);
const moneyText=(value:number)=>`${value<0?'-':''}¥${(Math.abs(value)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const visibleResultKeys=new Set(['name','title','tail','amount','balance','target','remaining','progress','value','cost','profit','period','category','merchant','date','kind','status','restriction','limit','channel','cycle','nextChargeAt','benefitUntil','asOf','expenses','grossExpenses','netExpenses','refunds','income','count','expenseCount','refundCount','current','baseline','summary','notice','message','guide','assumption','total','periodCount','subscriptions','transactions','cancellations','actual','projectedMonthlyReduction','risk','feeRate','price','type','liquidity','level','validUntil','direction','moved','calendar','budgets','spending','content','topic','bindings','deadline','months','cancelUntil','comparison','baselinePeriod','changePercent','unavailableReason','insights','text','label','reason','use','nextStep','businessStage','estimatedArrivalAt','calendarNotice','feeNotice','fees','rate','worstCase','riskNotice','productName','purpose','paths','materials','officialSteps','nextActions','merchantSubscriptionState','bankAgreementState','chargeState','executionState','executionNotice','execution','delivery','netAmount','fee','changeAmount','baselineNetExpenses','categoryBreakdown','assessmentState','profile','participants','shares','perPerson','savingRule','transaction','subscription','card','goal','monthlyAmount','schedule','createdAt','lostAt','settledAt','issuer','alias','phone','person','remindAt','leadDays','threshold','productType','action']);
Object.assign(resultLabels,{shares:'每人分摊',perPerson:'每人金额',savingRule:'自动转存',transaction:'交易',subscription:'订阅',card:'银行卡',goal:'储蓄目标',alias:'别名',phone:'手机号',person:'往来对象',remindAt:'提醒时间',leadDays:'提前天数',threshold:'提醒阈值',productType:'卡片类型',action:'操作',schedule:'周期'});
Object.assign(values,{active:'正常',withdrawn:'已撤回',supplement_received:'补充材料已收件',closed:'已关闭',unpaid:'待付款',user_reconciled:'已核销',credit_limit:'授信额度申请',goal:'目标储蓄',transfer:'转账',shares_confirmed:'份额已确认',funds_arrived:'资金已到账',bank_mandate_stopped:'银行代扣已停止',transferred:'已转出',scheduled_not_connected:'自动执行尚未启用',not_found:'暂无测评记录'});
visibleResultKeys.add('orders');
for(const key of ['reminders','to','detail','receivable','received','outstanding','rule','available','held'])visibleResultKeys.add(key);
Object.assign(resultLabels,{available:'可用余额',held:'申购占用'});
for(const key of ['recentTransactions','coverage'])visibleResultKeys.add(key);
for(const key of ['source','basis','planned','items','label'])visibleResultKeys.add(key);Object.assign(resultLabels,{source:'来源',basis:'口径',planned:'计划支出合计',items:'分项',label:'项目'});moneyKeys.add('planned');Object.assign(resultLabels,{recentTransactions:'本卡已取得的流水',coverage:'数据范围'});moneyKeys.add('available');moneyKeys.add('held');
Object.assign(resultLabels,{reminders:'提醒',to:'发给',detail:'构成',receivable:'应收合计',received:'已收',outstanding:'待收',rule:'分摊规则'});
Object.assign(values,{self:'本人承担',paid:'已付',simulated_sent:'已发送',awaiting_payment:'等待付款',collected:'已收齐'});
const resultText=(value:unknown)=>typeof value==='string'?(values[value]||actionLabel[value]||value):String(value);
Object.assign(resultLabels,{risk:'风险等级',feeRate:'交易费率',price:'单位净值',type:'类型'});
type WorkflowResultProps={value:unknown;field?:string;depth?:number};
function CategoryBreakdown({value}:{value:unknown[]}){
 const rows=value.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'&&!Array.isArray(row));
 const largest=Math.max(0,...rows.map(row=>typeof row.netExpenses==='number'?Math.abs(row.netExpenses):0));
 return <figure aria-label="分类净支出条形图" className="viz-breakdown"><figcaption>分类净支出（已扣退款）</figcaption><ul className="viz-rank">{rows.map((row,index)=>{
  const amount=typeof row.netExpenses==='number'?row.netExpenses:null;
  return <li key={`${String(row.category)}-${index}`} data-tip={`${String(row.category||'未知类别')} ${amount===null?'金额未知':moneyText(amount)}`} aria-label={`${String(row.category||'未知类别')}，${amount===null?'金额未知':moneyText(amount)}`}>
   <span className="viz-rank-label">{String(row.category||'未知类别')}{row.classificationSource==='merchant-map'&&<small>推断</small>}</span>
   <span className="viz-rank-track"><i className={amount!==null&&amount<0?'is-negative':''} style={{width:`${amount===null||largest===0?0:Math.abs(amount)/largest*100}%`}}/></span>
   <b>{amount===null?'金额未知':moneyText(amount)}</b>
  </li>;
 })}</ul></figure>;
}
const COLLAPSE_AFTER=5,NESTED_FIELDS=6;
type CompactRow={title:string;meta:string;amount?:string;positive?:boolean;follow?:{label:string;functionId:string;params:Params}};
const isRecordRows=(value:unknown[]):value is Record<string,unknown>[]=>value.length>0&&value.every(row=>!!row&&typeof row==='object'&&!Array.isArray(row));
function transactionRow(item:Record<string,unknown>):CompactRow{
 const category=known(item.category)?`${item.category}${item.classificationSource==='merchant-map'?'（推断）':''}`:'';
 return {title:known(item.merchant)?String(item.merchant):'未知商户',meta:[item.date,category,item.kind&&resultText(item.kind)].filter(known).filter(Boolean).map(value=>localDate(String(value))).join(' · '),amount:moneyText(item.amount as number),positive:item.kind==='refund',follow:known(item.id)&&item.kind==='expense'?{label:'纠正分类',functionId:'BI03',params:{transactionId:item.id}}:undefined};
}
function subscriptionRow(item:Record<string,unknown>):CompactRow{
 const until=known(item.benefitUntil)&&item.benefitUntil!==item.nextChargeAt?`权益至 ${item.benefitUntil}`:'';
 const status=known(item.status)&&item.status!=='active'?resultText(item.status):'';
 return {title:known(item.name)?String(item.name):'未知订阅',meta:[item.channel&&resultText(item.channel),item.cycle&&resultText(item.cycle),known(item.nextChargeAt)?`下次扣款 ${item.nextChargeAt}`:'',until,status].filter(known).filter(Boolean).join(' · '),amount:moneyText(item.amount as number),follow:known(item.id)&&item.status==='active'?{label:'不再使用 · 看处理路径',functionId:'SU04',params:{subscriptionId:item.id}}:undefined};
}
function calendarRow(item:Record<string,unknown>):CompactRow{
 return {title:String(item.name),meta:[`${item.source?'日期':'扣款日'} ${item.date}`,known(item.source)?String(item.source):'',known(item.status)&&item.status!=='active'?resultText(item.status):''].filter(Boolean).join(' · '),amount:moneyText(item.amount as number)};
}
const compactRowsFor=(value:unknown[]):CompactRow[]|null=>{
 if(!isRecordRows(value))return null;
 if(value.every(row=>'merchant' in row&&typeof row.amount==='number'))return value.map(transactionRow);
 if(value.every(row=>typeof row.name==='string'&&typeof row.amount==='number'&&'cycle' in row))return value.map(subscriptionRow);
 if(value.every(row=>typeof row.name==='string'&&typeof row.amount==='number'&&known(row.date)))return value.map(calendarRow);
 return null;
};
function CompactList({rows,noun}:{rows:CompactRow[];noun:string}){
 const follow=useContext(FollowUp);
 const row=(item:CompactRow,index:number)=><li className="compact-row" key={index}>
  <div className="compact-main"><strong>{item.title}</strong><span>{item.meta}</span></div>
  {item.amount&&<strong className={`compact-amount ${item.positive?'is-positive':''}`}>{item.positive?'+':''}{item.amount}</strong>}
  {follow&&item.follow&&<button className="pill-button" onClick={()=>follow(item.follow!.functionId,item.follow!.params)}>{item.follow.label}</button>}
 </li>;
 const list={listStyle:'none',margin:0,padding:0} as const;
 return <div><ul style={list}>{rows.slice(0,COLLAPSE_AFTER).map(row)}</ul>{rows.length>COLLAPSE_AFTER&&<details style={{fontSize:12}}><summary style={{cursor:'pointer',color:'#59687e',padding:'8px 0'}}>查看全部 {rows.length} {noun}</summary><ul style={list}>{rows.slice(COLLAPSE_AFTER).map((item,index)=>row(item,index+COLLAPSE_AFTER))}</ul></details>}</div>;
}
export function WorkflowResult({value,field='',depth=0}:WorkflowResultProps){
 if(field==='categoryBreakdown'&&Array.isArray(value))return <CategoryBreakdown value={value}/>;
 if(Array.isArray(value)){const compact=compactRowsFor(value);if(compact)return <CompactList rows={compact} noun={'merchant' in (value[0] as object)?'笔':'项'}/>;}
 if(value==null)return <span>未知</span>;
 if(typeof value==='boolean')return <span>{value?'是':'否'}</span>;
 if(typeof value==='number')return <span>{moneyKeys.has(field)?moneyText(value):field==='progress'?(value*100).toFixed(1)+'%':field==='changePercent'?value.toFixed(1)+'%':['feeRate','rate'].includes(field)?`${value}%`:String(value)}</span>;
 if(typeof value!=='object'){const text=resultMessage(field,localDate(resultText(value)));return text?<span>{text}</span>:null;}
 if(depth>4)return <span>详见关联记录</span>;
 if(!Array.isArray(value)){const single=compactRowsFor([value]);if(single&&field==='subscription')return <CompactList rows={single} noun="项"/>;}
 if(Array.isArray(value)){
  if(!value.length)return <p>当前范围内没有记录。</p>;
  const rowView=(v:unknown,i:number)=><div className="flow-result-row" key={i}><WorkflowResult value={v} depth={depth+1}/></div>;
  return <div className="flow-results">{value.slice(0,COLLAPSE_AFTER).map(rowView)}{value.length>COLLAPSE_AFTER&&<details style={{fontSize:12}}><summary style={{cursor:'pointer',color:'#59687e',padding:'8px 0'}}>查看全部 {value.length} 条</summary>{value.slice(COLLAPSE_AFTER).map((v,i)=>rowView(v,i+COLLAPSE_AFTER))}</details>}</div>;
 }
 const entries=Object.entries(value).filter(([k,v])=>v!==undefined&&visibleResultKeys.has(k)&&(typeof v!=='string'||resultMessage(k,resultText(v))!==''));
 const entryView=([k,v]:[string,unknown])=><div key={k} style={v&&typeof v==='object'?{gridTemplateColumns:'minmax(0,1fr)',gap:4}:undefined}><dt>{resultLabels[k]}</dt><dd><WorkflowResult value={v} field={k} depth={depth+1}/></dd></div>;
 // Nested objects stay glanceable; the full field list is one tap away.
 if(depth>0&&entries.length>NESTED_FIELDS)return <><dl className="flow-result-fields">{entries.slice(0,NESTED_FIELDS).map(entryView)}</dl><details style={{fontSize:12}}><summary style={{cursor:'pointer',color:'#59687e',padding:'8px 0'}}>查看其余 {entries.length-NESTED_FIELDS} 项</summary><dl className="flow-result-fields">{entries.slice(NESTED_FIELDS).map(entryView)}</dl></details></>;
 return <dl className="flow-result-fields">{entries.map(entryView)}</dl>;
}

function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function known(value:unknown):value is string|number{return (typeof value==='string'&&value.trim()!=='')||(typeof value==='number'&&Number.isFinite(value));}
function riskLabel(value:unknown){return typeof value==='number'&&Number.isFinite(value)?`等级 ${value}`:known(value)?String(value):'暂未提供';}
function feeRateLabel(product:Record<string,unknown>){return typeof product.feeRate==='number'&&Number.isFinite(product.feeRate)?`${product.feeRate}%`:'暂未提供';}
function feeDetail(product:Record<string,unknown>){
 const fees=Array.isArray(product.fees)?product.fees.map(record):[];
 return fees.map((fee,index)=><li key={`${String(fee.name||index)}-${index}`}>{known(fee.name)?String(fee.name):'费用'}：{typeof fee.rate==='number'&&Number.isFinite(fee.rate)?`${fee.rate}%`:'暂未提供'}</li>);
}
function ProductComparison({value}:{value:unknown}){
 const products=Array.isArray(record(value).products)?(record(value).products as unknown[]).map(record):[];
 const rows:[string,(product:Record<string,unknown>)=>string][]=[
  ['风险等级',product=>riskLabel(product.risk)],
  ['费用',product=>feeRateLabel(product)],
  ['流动性',product=>known(product.liquidity)?resultMessage('liquidity',String(product.liquidity)):'暂未提供'],
 ];
 return <section data-testid="product-comparison" aria-label="产品对比">
  <div style={{display:'grid',gridTemplateColumns:`minmax(0,.72fr) repeat(${Math.max(1,products.length)},minmax(0,1fr))`,gap:6,fontSize:12,overflowWrap:'anywhere',wordBreak:'break-word'}}>
   <strong style={{padding:'8px 4px'}}>关键项</strong>{products.map((product,index)=><strong key={`name-${index}`} style={{padding:'8px 4px',minWidth:0}}>{known(product.name)?String(product.name):'暂未提供'}</strong>)}
   <span style={{padding:'8px 4px',borderTop:'1px solid #edf1f6',color:'#718094'}}>风险刻度</span>{products.map((product,index)=><span key={`scale-${index}`} style={{padding:'8px 4px',borderTop:'1px solid #edf1f6',minWidth:0}}>{typeof product.risk==='number'&&<LevelScale prefix="R" level={product.risk}/>}</span>)}{rows.map(([label,read])=><Fragment key={label}><span style={{padding:'8px 4px',borderTop:'1px solid #edf1f6',color:'#718094'}}>{label}</span>{products.map((product,index)=><span key={`${label}-${index}`} style={{padding:'8px 4px',borderTop:'1px solid #edf1f6',minWidth:0}}>{read(product)}</span>)}</Fragment>)}
  </div>
  <details style={{marginTop:8,fontSize:12}}><summary style={{cursor:'pointer',color:'#59687e'}}>查看费用明细</summary><div style={{display:'grid',gridTemplateColumns:`repeat(${Math.max(1,products.length)},minmax(0,1fr))`,gap:8,marginTop:8,overflowWrap:'anywhere',wordBreak:'break-word'}}>{products.map((product,index)=>{const fees=feeDetail(product);return <div key={`fees-${index}`}><strong>{known(product.name)?String(product.name):'产品'}</strong><ul style={{margin:'6px 0 0',paddingLeft:16}}>{fees.length?fees:<li>暂未提供</li>}</ul></div>;})}</div></details>
 </section>;
}
function MonthlyReport({value}:{value:unknown}){
 const report=record(value),summary=record(report.summary),comparison=record(report.comparison);
 const period=known(summary.period)?String(summary.period):known(report.period)?String(report.period):'';
 const amount=(key:string)=>typeof summary[key]==='number'?moneyText(summary[key] as number):'暂未提供';
 const delta=comparison.changeAmount,percent=comparison.changePercent,baseline=known(comparison.baselinePeriod)?String(comparison.baselinePeriod):'上期';
 const trend=typeof delta==='number'?`较${baseline}净支出${delta>0?'增加':delta<0?'减少':'持平'}${delta===0?'':` ${moneyText(Math.abs(delta))}`}${typeof percent==='number'?`（${percent>0?'+':''}${percent.toFixed(1)}%）`:comparison.unavailableReason==='基期净支出为0，百分比不可比。'?'；基期净支出为0，百分比暂不可比。':'；暂无可比基期，暂不计算环比。'}`:'暂无可比基期，暂不计算环比。';
 const insights=Array.isArray(report.insights)?report.insights.map(record).filter(item=>typeof item.text==='string'):[];
 return <section aria-label="月报摘要" style={{minWidth:0,overflowWrap:'anywhere'}}>
  {period&&<p style={{fontSize:12,color:'#718094',marginBottom:8}}>{period} {report.periodType==='year'?'年报':'月报'}</p>}
  <Kpis items={[{label:'净支出',value:amount('netExpenses'),lead:true},{label:'退款',value:amount('refunds')},{label:'笔数',value:typeof summary.count==='number'?String(summary.count):'—'}]}/>
  <p className={`viz-trend ${typeof delta==='number'?delta>0?'is-up':delta<0?'is-down':'':''}`}>{trend}</p>
  <div style={{margin:'12px 0'}}><CategoryBreakdown value={Array.isArray(report.categoryBreakdown)?report.categoryBreakdown:[]}/></div>
  <details style={{fontSize:12}}><summary style={{cursor:'pointer',color:'#59687e'}}>查看月报小结</summary><ul style={{paddingLeft:18,lineHeight:1.6}}>{insights.map((item,index)=><li key={index}>{String(item.text)}</li>)}</ul></details>
 </section>;
}
function ProductList({value}:{value:unknown}){
 const products=(Array.isArray(value)?value:[value]).map(record);
 if(!products.length)return <p className="card-description">没有符合条件的产品。</p>;
 const risk=products.find(product=>known(product.worstCase))?.worstCase;
 return <div className="product-results"><ul className="product-list">{products.map((product,index)=>{
  const details=Object.fromEntries(Object.entries(product).filter(([key])=>!['name','type','risk'].includes(key)));
  const liquidity=known(product.liquidity)?String(product.liquidity):'';
  return <li className="product-item" key={String(product.id||index)}>
   <h3>{known(product.name)?String(product.name):'未命名产品'}</h3>
   <p className="product-meta">{[known(product.type)?resultText(product.type):'',known(product.risk)?`风险等级 ${product.risk}`:'风险等级暂未提供'].filter(Boolean).join(' · ')}</p>
   {typeof product.risk==='number'&&<LevelScale prefix="R" level={product.risk}/>}{liquidity&&<p className="product-availability">{/沙箱手动推进/.test(liquidity)?'赎回预计 T+1 工作日到账':resultMessage('liquidity',liquidity)}</p>}
   <details className="result-details"><summary>产品详情</summary><WorkflowResult value={details}/></details>
  </li>;
 })}</ul>{known(risk)&&<p className="product-risk">{resultMessage('worstCase',String(risk))}</p>}</div>;
}
function Statement({value}:{value:unknown}){
 const result=record(value),summary=record(result.summary),transactions=result.transactions as unknown[];
 const rest=Object.fromEntries(Object.entries(summary).filter(([key])=>!['netExpenses','refunds'].includes(key)));
 return <div className="statement-result">
  <div className="statement-totals"><div><span>净支出</span><strong>{typeof summary.netExpenses==='number'?moneyText(summary.netExpenses):'待核对'}</strong></div>{typeof summary.refunds==='number'&&<div><span>退款</span><strong>{moneyText(summary.refunds)}</strong></div>}{typeof summary.count==='number'&&<div><span>笔数</span><strong>{summary.count}</strong></div>}</div>
  {dailyNet(transactions).length>1&&<Columns label="每日净支出" rows={dailyNet(transactions).map(day=>({key:day.date,tick:day.date.slice(5),value:day.value,tip:`${day.date} ${moneyText(day.value)}`}))}/>}
  {typeof result.transactionsTrimmed==='number'?<p className="result-timestamp">{result.transactionsTrimmed} 条明细已收起，再问一次可查看。</p>:<WorkflowResult value={transactions}/>}
  <details className="result-details"><summary>统计详情</summary><WorkflowResult value={rest}/>{known(result.asOf)&&<p className="result-timestamp">更新于 {localDate(String(result.asOf))}</p>}</details>
 </div>;
}
const NOTE_KEYS=['notice','message','assumption','executionNotice','explanation','delivery','protection','responsibilityNotice','riskNotice','worstCase','feeNotice','calendarNotice','coverage'];
/** Limits stay readable next to the picture; they are never tucked away behind it. */
function Notes({value}:{value:unknown}){
 const row=record(value),lines=[...new Set(NOTE_KEYS.map(key=>typeof row[key]==='string'?resultMessage(key,row[key] as string):'').filter(Boolean))];
 return lines.length?<div className="viz-notes">{lines.map(line=><p key={line}>{line}</p>)}</div>:null;
}
export function BusinessResult({functionId,value,bank}:{functionId:string;value:unknown;bank?:BankState}){
 if(functionId==='BI01'&&Array.isArray(record(value).transactions)||functionId==='BI02'&&record(value).current){
  const result=record(value),scope=record(result.scope);
  const totals=record(result.current);
  return <>{known(scope.label)&&<p className="scope-line" aria-label="查询范围">{String(scope.label)}</p>}{functionId==='BI01'&&Array.isArray(result.transactions)?<Statement value={value}/>:<div className="statement-result"><div className="statement-totals"><div><span>净支出</span><strong>{typeof totals.netExpenses==='number'?moneyText(totals.netExpenses):'待核对'}</strong></div><div><span>退款</span><strong>{typeof totals.refunds==='number'?moneyText(totals.refunds):'待核对'}</strong></div></div>{typeof record(result.baseline).netExpenses==='number'&&<Columns label="净支出对比" rows={[{key:'base',tick:known(record(result.baseline).period)?String(record(result.baseline).period):'比较期',value:record(result.baseline).netExpenses as number,tip:`比较期 ${moneyText(record(result.baseline).netExpenses as number)}`},{key:'now',tick:known(totals.period)?String(totals.period):'本期',value:Number(totals.netExpenses)||0,tip:`本期 ${moneyText(Number(totals.netExpenses)||0)}`,emphasis:true}]}/>}<p className="query-scope">{totals.count===0?'当前范围内没有记录。':`共${totals.count}笔记录，消费${totals.expenseCount}笔，退款${totals.refundCount}笔。`}</p></div>}{functionId==='BI02'&&Array.isArray(result.transactions)&&<><SpendCharts rows={(result.transactions as unknown[]).map(record)}/><BillDetail rows={(result.transactions as unknown[]).map(record)}/></>}{functionId==='BI02'&&<details className="result-details"><summary>统计详情</summary><WorkflowResult value={{current:result.current,...(result.baseline?{baseline:result.baseline}:{})}}/></details>}</>;
 }
 if(functionId==='IN06'&&(Array.isArray(value)||known(record(value).name)))return <div className="viz-result"><ProductsCard value={value}/><details className="result-details"><summary>详情</summary><ProductList value={value}/></details></div>;
 if(functionId==='IN07'&&Array.isArray(record(value).products))return <div className="viz-result"><CompareCard value={value}/><details className="result-details"><summary>查看费用明细</summary><ProductComparison value={value}/></details></div>;
 if(functionId==='BI06')return <MonthlyReport value={value}/>;
 // “取消了吗”: the mandate, then what the bank, the provider and the charges each show, side by side.
 if(functionId==='SU05'&&record(value).subscription)return <div className="viz-result"><SubscriptionTile sub={record(record(value).subscription)}/><SubscriptionStates value={value}/><details className="result-details"><summary>详情</summary><WorkflowResult value={value}/></details></div>;
 const viz=businessViz(functionId,value,bank);
 // A lesson already shows everything it holds; its raw fields (主题、测评结果“未知”) would only repeat it.
 if(viz)return <div className="viz-result">{viz}{functionId!=='TR11'&&<GuideSteps value={value}/>}{functionId!=='IN15'&&<details className="result-details"><summary>详情</summary><WorkflowResult value={value}/></details>}</div>;
 return <div className="viz-result"><GuideSteps value={value}/><WorkflowResult value={value}/></div>;
}

export function WorkflowSummary({bank,task,compact=false}:{bank:BankState;task:FlowTask;compact?:boolean}) {
 const entries=reviewEntries(bank,task);
 if(!entries.length)return null;
 const amount=isWrite(task)?entries.find(entry=>entry.key==='amount'):undefined;
 return <section className={`flow-review ${compact?'compact-review':''}`} aria-label="执行前核对卡">{amount&&<div className="review-amount"><span>{amount.label}</span><strong>{amount.value}</strong></div>}<dl className="flow-result-fields">{entries.filter(entry=>entry!==amount).map(entry=><div key={entry.key}><dt>{entry.label}</dt><dd>{entry.key==='action'&&entry.value==='assess'?'开始测评':entry.value}</dd></div>)}</dl></section>;
}

export function WorkflowOutcome({bank,task,busy,onRun}:{bank:BankState;task:FlowTask;busy?:boolean;onRun?:(functionId:string,params:Params)=>void}) {
 const body=(()=>{
  if(task.functionId==='TR03'){
   const receipt=bank.receipts.find(item=>item.taskId===task.legacyTaskId);
   return <><ReceiptStatus bank={bank} task={task}/><ReviewViz bank={bank} task={task} receipt/><WorkflowSummary bank={bank} task={task}/>{receipt?<div className="card-rows"><Row label="回执编号" value={<code>{receipt.id}</code>}/><Row label="完成时间" value={`${localDate(receipt.createdAt)}（北京时间）`}/></div>:<BusinessResult functionId={task.functionId} value={task.result} bank={bank}/>}</>;
  }
  if(task.functionId==='TR05'&&task.params.action!=='remind'){
   const sessions=Array.isArray(task.result)?task.result:[task.result];
   if(sessions.length&&sessions.every(item=>Array.isArray((item as {participants?:unknown}|null)?.participants)))return <>{sessions.map((item,index)=><AaStatus key={index} bank={bank} value={item} busy={busy} onRemind={onRun&&(sessionId=>onRun('TR05',{action:'remind',sessionId}))}/>)}</>;
  }
  if(task.functionId==='SU04'&&task.status==='complete'&&record(task.result).status==='bank_cancelled')return <><ReceiptStatus bank={bank} task={task}/><SubscriptionStates value={task.result}/><BusinessResult functionId={task.functionId} value={{notice:record(task.result).notice}}/></>;
  if(['TR01','TR02'].includes(task.functionId)&&Array.isArray(task.result))return <BusinessResult functionId={task.functionId} value={task.result} bank={bank}/>;
  return <><ReceiptStatus bank={bank} task={task}/><BusinessResult functionId={task.functionId} value={task.result} bank={bank}/>{isWrite(task)&&task.status==='complete'&&<details className="result-details"><summary>办理内容</summary><WorkflowSummary bank={bank} task={task} compact/></details>}{task.functionId==='CA06'&&task.status==='complete'&&task.params.action!=='unfreeze'&&<p className="warn-line">临时冻结 ≠ 正式挂失。</p>}{task.functionId==='IN08'&&task.status==='complete'&&<p className="note-line">份额确认后计入持仓。</p>}</>;
 })();
 return <FollowUp.Provider value={onRun||null}><div className="flow-result" role="region" aria-label="办理结果">{body}</div></FollowUp.Provider>;
}

type PanelProps={bank:BankState;busy:boolean;onAction:(a:BankAction)=>Promise<void>;serial?:boolean;catalog?:boolean;onClose?:()=>void};
/** What an AA draft already holds, so a head count and a carve-out the user said are visible before the names are complete. */
function AaDraftNote({task}:{task:FlowTask}){
 const p=task.params,named=Array.isArray(p.participants)?p.participants as string[]:[],items=Array.isArray(p.adjustments)?p.adjustments as {label:string;amount:number;participants:string[]}[]:[];
 const parts=[typeof p.total==='number'?`总额 ¥${p.total}`:'',typeof p.headcount==='number'?`共 ${p.headcount} 人`:'',named.length?`已记下：${named.join('、')}`:'',...items.map(item=>`${item.label} ¥${item.amount} 由${item.participants.join('、')}分摊`)].filter(Boolean);
 return parts.length?<ul className="aa-draft-note" aria-label="已记下的分摊信息">{parts.map(part=><li key={part}>{part}</li>)}</ul>:null;
}

/** The header exit for an open card. With other unfinished checklist items the user picks this item or the whole list. */
export function TaskCancel({bank,task,busy,onAction}:{bank:BankState;task:FlowTask;busy:boolean;onAction:(action:BankAction)=>Promise<void>}){
 if(!['collecting','review','authenticate','blocked'].includes(task.status))return null;
 const others=(bank.plan&&!['complete','cancelled'].includes(bank.plan.status)?bank.plan.steps.filter(step=>step.taskId!==task.id&&!['complete','cancelled'].includes(step.status)).length:0);
 const one=()=>void onAction({type:'workflow',command:{operation:'cancel',taskId:task.id,source:'card'}});
 const choices=others?[{label:'只取消这一项',run:one,primary:true},{label:`结束整份清单（还有${others}项）`,run:()=>void onAction({type:'plan',command:{operation:'cancel',source:'card'}})}]:[{label:'放弃办理',run:one,primary:true}];
 const who=taskIdentity(bank,task);
 return <CancelTask busy={busy} ask={['review','authenticate'].includes(task.status)||others>0} summary={`“${who.title}${who.detail?`（${who.detail}）`:''}”`} choices={choices}/>;
}

export function WorkflowPanel(props:PanelProps){
 const task=!props.catalog&&props.bank.view==='workflow'?currentWorkflow(props.bank):undefined;
 return <WorkflowPanelState key={task?[task.id,task.reviewToken,task.verificationId,task.status,JSON.stringify(task.params)].join(':'):'launcher'} {...props}/>;
}
function WorkflowPanelState({bank,busy,onAction,serial=false,catalog=false,onClose}:PanelProps){
 const task=!catalog&&bank.view==='workflow'?currentWorkflow(bank):undefined;
 const offered=USER_FUNCTIONS.filter(item=>!UNSUPPORTED_FUNCTIONS.has(item.id));
 const active=offered.find(item=>item.id===task?.functionId);
 const [module,setModule]=useState(active?.moduleId||'M2');
 const [functionId,setFunctionId]=useState(active?.id||'BI02');
 const [draft,setDraft]=useState<Params>(task?.params||{});
 const [dirty,setDirty]=useState(false),[code,setCode]=useState('');
 const [pane,setPane]=useState<'main'|'edit'|'preview'>('main'),[riskAck,setRiskAck]=useState(false);
 const command=(c:Omit<WorkflowCommand,'source'>)=>onAction({type:'workflow',command:{...c,source:'card'}});
 const change=(key:string,value:unknown)=>{setDraft(previous=>({...previous,[key]:value}));setDirty(true);};
 // List fields keep what the user typed (a trailing comma included); only the stored draft is split.
 const [listText,setListText]=useState<Record<string,string>>({});
 const run=(id:string,params:Params={})=>command({operation:'run',functionId:id,params});
 const required=task?[...new Set([...requiredFields(task.functionId,draft),...task.missing])]:[];
 const fields=task?(FIELDS[task.functionId]||[]):[];
 const hiddenFields=task?.functionId==='BI08'?new Set(['items']):task?.functionId==='TR05'
  ?new Set(['adjustments',...(draft.action==='create'?['sessionId']:[]),...(['list','remind'].includes(String(draft.action))?['total','participants']:[])])
  :new Set<string>();
 // 用户说的话已定下操作时，卡片只办这一件事，不再让人在查询、删除等无关操作间切换。
 if(task?.params.action)hiddenFields.add('action');
 if(task&&['list','get','query','status','guide'].includes(String(draft.action)))hiddenFields.add('amount');
 const visibleFields=fields.filter(key=>!hiddenFields.has(key)&&(!unavailableFields.has(key)||required.includes(key))&&!(task?.functionId==='IN01'&&draft.autoSave!==true&&['accountId','amount','schedule'].includes(key))&&!(task?.functionId==='IN04'&&key==='ruleId'));
 const labelFor=(key:string)=>(fieldLabels[key]||LABELS[key]||'').replace('（可选）','');
 const caption0=(key:string,label:string)=>label+(required.includes(key)?'':'（可选）');
 const field=(key:string)=>{
  const label=labelFor(key);
  if(!label)return null;
  const actions=(ACTIONS[task!.functionId]||[]).filter(value=>(task!.functionId!=='TR05'||!['update','remind'].includes(value))&&(task!.functionId!=='BI08'||value!=='estimate'||draft.action==='estimate'));// 分项估算的明细只能口述，卡片没有输入项
  const opts=(key==='action'?actions.map(value=>({value,label:actionLabel[value]||value})):choices(bank,key)).map((option,index)=>({...option,label:key!=='category'&&option.label===option.value?`${label} ${index+1}`:option.label}));
  if(key==='answers')return <fieldset key={key} className="flow-questionnaire"><legend>风险测评</legend>{RISK_QUESTIONS.map(({title,labels},index)=><div className="flow-field" key={title}><span>{title}</span><FlowSelect label={title} inline={5} value={String((draft.answers as number[]||[])[index]||'')} onChange={value=>{const answers=[...((draft.answers as number[])||[0,0,0])];answers[index]=Number(value);change('answers',answers);}} options={labels.map((text,i)=>({value:String(i+1),label:text}))}/></div>)}</fieldset>;
  if(key==='saveRecipient'||key==='autoSave')return <label className="flow-check" key={key}><input type="checkbox" checked={draft[key]===true} onChange={event=>change(key,event.target.checked)}/>{key==='saveRecipient'?'保存为联系人':'自动转存'}</label>;
  if(key==='recipientId'&&task!.functionId==='TR03'){
   const narrowed=contactsOf(bank).filter(contact=>!task!.recipientChoices?.length||task!.recipientChoices.includes(contact.id));
   return <div key={key} className="flow-field"><span>{caption0(key,label)}</span><div className="choice-list" role="radiogroup" aria-label={label}>{narrowed.map(contact=><button type="button" role="radio" aria-checked={draft.recipientId===contact.id} data-value={contact.id} aria-label={`${contact.label}${contact.name} · ${contact.tail}`} className="cand" key={contact.id} onClick={()=>change(key,contact.id)}><span className="cand-radio"/><b>{contact.name}</b><span>{contact.label}</span><small>尾号 {contact.tail}</small></button>)}</div><p className="note-line">联系人备注只用于辨认，不代替账户核验</p></div>;
  }
  const optionList=opts.map(option=>({value:option.value,label:option.label}));
  const caption=label+(required.includes(key)?'':'（可选）');
  if(opts.length)return <div key={key} className="flow-field"><span>{caption}</span>{key==='productIds'?<FlowMulti label={label} options={optionList} value={(draft[key] as string[])||[]} onChange={value=>change(key,value)}/>:<FlowSelect label={label} options={optionList} placeholder={['BI01','BI02'].includes(task!.functionId)&&key==='category'?'全部类别':['BI01','BI02'].includes(task!.functionId)&&key==='accountId'?'全部账户':undefined} value={String(draft[key]??'')} onChange={value=>change(key,value)}/>}</div>;
  // 记录类字段没有可选项时，不让用户手填内部编号。
  if(/Id$/.test(key))return <div key={key} className="flow-field"><span>{caption}</span><p className="note-line">暂无可选记录</p></div>;
  return <label key={key} className="flow-field">{caption}
   <input aria-label={label} value={listText[key]??(Array.isArray(draft[key])?(draft[key]as unknown[]).join('，'):typeof draft[key]==='boolean'||typeof draft[key]==='object'?'':String(draft[key]??''))} placeholder={key==='period'?(required.includes(key)?'例如 2026-11':'例如 2026-10，留空为全部期间'):key==='merchant'?'商户名称，留空为全部商户':key==='deadline'?'例如 2027-06-01':key==='participants'?'参与者姓名，用逗号分隔':''} onChange={event=>{const list=['participants','incomeDates'].includes(key);if(list)setListText(previous=>({...previous,[key]:event.target.value}));change(key,list?event.target.value.split(/[，,]/).map(value=>value.trim()).filter(Boolean):key==='note'&&event.target.value===''?null:event.target.value);}}/></label>;
 };
 const editable=task&&!(task.functionId==='IN05'&&task.params.action==='status')&&!['authenticate','cancelled','unsupported','external'].includes(task.status)&&!(task.status==='complete'&&isWrite(task));
 const primaryQueryFields=task&&['BI01','BI02'].includes(task.functionId)?['period','merchant','category','accountId']:[];
 const noExtras=['pause','resume','delete','close','status','list','activate','withdraw','mark_done','remind','report'].includes(String(draft.action));
 const optionalFields=noExtras?[]:visibleFields.filter(key=>!required.includes(key)&&!primaryQueryFields.includes(key)&&!Object.hasOwn(task?.params||{},key));
 const description=task?workflowMessage(task):'';
 const review=task?reviewEntries(bank,task):[];
 const save=()=>task!.status==='complete'?run(task!.functionId,draft):command({operation:'amend',taskId:task!.id,params:changedFields(draft,task!.params)});
 if(serial&&task){
  const keys=visibleFields.filter(key=>required.includes(key)||primaryQueryFields.includes(key)||Object.hasOwn(task.params,key));
  const editing=pane==='edit'||task.status==='collecting';
  const discard=()=>{setDraft(task.params);setListText({});setDirty(false);setPane('main');};
  const fraudStop=task.status==='blocked'&&['TR03','TR04'].includes(task.functionId)&&!!task.riskSignals?.length;
  const suitabilityBlock=task.status==='blocked'&&['IN08','IN13'].includes(task.functionId)&&/测评/.test(task.message);
  return <section className="business-card workflow-card serial-card" aria-label="功能办理卡片" data-status={task.status}>
   <CardHead head={pane==='preview'?{title:'办理预览',icon:'file'}:cardHead(bank,task)}>{pane==='main'&&<TaskCancel bank={bank} task={task} busy={busy} onAction={onAction}/>}<button className="text-button" disabled={busy} onClick={()=>pane!=='main'?discard():void onAction({type:'home'})}>{pane==='edit'?'放弃修改':pane==='preview'?'返回核对':'收起'}</button></CardHead>
   {pane==='main'&&isWrite(task)&&['collecting','review','authenticate','complete'].includes(task.status)&&<ProcessSteps label="办理步骤" steps={writeSteps(task.status,needsAuth(task))}/>}
   {task.queryClarification&&<p className="card-description" role="status">{task.queryClarification.message}</p>}
   {pane==='preview'?<WorkflowOutcome bank={bank} task={task}/>:editing?<>
    {task.functionId==='TR05'&&task.params.action==='create'&&<AaDraftNote task={task}/>}
    <form className="flow-editor" onSubmit={event=>{event.preventDefault();event.currentTarget.querySelector('input')?.blur();void save();}}><fieldset disabled={busy} className="flow-fields"><div className="flow-form">{keys.map(key=><div key={key} data-missing={task.missing.includes(key)}>{field(key)}</div>)}</div>{optionalFields.length>0&&<details className="flow-optional"><summary>更多选项</summary><div className="flow-form">{optionalFields.map(field)}</div></details>}</fieldset><button className="primary-button" disabled={busy||!dirty}>{task.status==='collecting'?'继续':'保存修改'}</button></form>
    {dirty&&task.status==='review'&&<p className="unsaved-note" role="status">修改尚未保存，请保存后重新核对。</p>}
   </>:task.status==='review'?<>
    {description&&<p className="card-description">{description}</p>}
    <ReviewViz bank={bank} task={task}/>
    {task.functionId==='TR05'&&task.params.action==='create'?<AaCalculation bank={bank} task={task}/>:<WorkflowSummary bank={bank} task={task}/>}
    {reviewNotes(task).length>0&&<div className="card-rows">{reviewNotes(task).map(note=><Row key={note.label} label={note.label} value={note.value}/>)}</div>}
    <InvestRisk bank={bank} task={task}/>
    <InvestDisclosure bank={bank} task={task} acknowledged={riskAck} onAcknowledge={setRiskAck}/>
    <div className="card-actions"><button className="text-button" disabled={busy} onClick={()=>setPane('edit')}>修改信息</button>{task.result!=null&&!(task.functionId==='TR05'&&task.params.action==='create')&&<button className="text-button" onClick={()=>setPane('preview')}>查看预览</button>}<button className="text-button" disabled={busy} onClick={()=>void command({operation:'cancel',taskId:task.id})}>取消办理</button><button className="primary-button" disabled={busy||dirty||task.functionId==='IN08'&&!riskAck} onClick={()=>void command({operation:'confirm',taskId:task.id,token:task.reviewToken!})}>{task.functionId==='TR05'&&task.params.action==='create'?'手动确认名单与分摊':needsAuth(task)?'手动确认并认证':'手动确认'}</button></div>
   </>:task.status==='authenticate'?<><ReviewViz bank={bank} task={task}/><WorkflowSummary bank={bank} task={task} compact/><form onSubmit={event=>{event.preventDefault();event.currentTarget.querySelector('input')?.blur();void command({operation:'authenticate',taskId:task.id,token:task.verificationId!,code});}}><label className="flow-field">验证码<input aria-label="验证码" inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))}/></label><p className="auth-note">验证码 123456</p><div className="card-actions"><button className="primary-button" disabled={busy||code.length!==6}>验证并办理</button></div></form><div className="serial-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>void command({operation:'amend',taskId:task.id,params:{}})}>返回核对</button><button type="button" className="text-button" disabled={busy} onClick={()=>void command({operation:'cancel',taskId:task.id})}>取消办理</button></div></>:<>
    {description&&!fraudStop&&(task.result==null||/待|尚未|申请|商户/.test(description))&&<p className="card-description">{description}</p>}
    {task.result!=null&&<WorkflowOutcome bank={bank} task={task} busy={busy} onRun={(id,params)=>void run(id,params)}/>}
    {fraudStop?<FraudStop task={task} busy={busy} onAction={onAction}/>:suitabilityBlock?<SuitabilityStop bank={bank} task={task} busy={busy} onAction={onAction} onEdit={()=>setPane('edit')}/>:task.status==='blocked'?<div className="serial-actions"><button className="secondary-button" disabled={busy} onClick={()=>setPane('edit')}>修改信息</button><button className="secondary-button" disabled={busy} onClick={()=>void command({operation:'resume',taskId:task.id})}>重试</button><button className="text-button" disabled={busy} onClick={()=>void command({operation:'cancel',taskId:task.id})}>取消办理</button></div>:<div className="card-actions">{editable&&<button className="text-button" disabled={busy} onClick={()=>setPane('edit')}>调整查询</button>}<button className="primary-button" disabled={busy} onClick={()=>void onAction({type:'home'})}>完成</button></div>}
   </>}
   {!!task.limitations?.length&&<details className="flow-limitations"><summary>未完成事项</summary><ul>{task.limitations.map(reason=><li key={reason}>{userMessage(reason)}</li>)}</ul></details>}
  </section>;
 }
 if(serial&&!task&&!catalog)return null;
 if(catalog)return <section className="business-card serial-card" aria-label="选择业务"><CardHead head={{title:'想办理什么？',icon:'search'}}>{onClose&&<button className="text-button" onClick={onClose}>返回</button>}</CardHead><div className="flow-field catalog-modules"><span>业务类别</span><FlowSelect label="业务类别" inline={8} options={[...new Map(offered.map(item=>[item.moduleId,item.moduleName])).entries()].map(([id,name])=>({value:id,label:name}))} value={module} onChange={value=>{setModule(value);setFunctionId(offered.find(item=>item.moduleId===value)!.id);}}/></div><div className="flow-field"><span>业务</span><FlowSelect label="业务" inline={0} options={offered.filter(item=>item.moduleId===module).map(item=>({value:item.id,label:item.title}))} value={functionId} onChange={setFunctionId}/></div><button className="primary-button" disabled={busy} onClick={()=>void run(functionId)}>开始办理</button></section>;
 return <div className="workflow-area">
  {!task&&<>
   <div className="flow-shortcuts">{[['BI02','查账单',{period:'2026-10'}],['SU01','查订阅',{}],['IN06','看理财产品',{}],['CA01','查银行卡',{}]].map(([id,title,params])=><button key={String(id)} disabled={busy} onClick={()=>void run(String(id),params as Params)}>{String(title)}</button>)}</div>
   <details className="flow-launcher"><summary>更多业务</summary><div className="flow-launcher-body"><div className="flow-field"><span>业务类别</span><FlowSelect label="业务模块" inline={0} options={[...new Map(offered.map(item=>[item.moduleId,item.moduleName])).entries()].map(([id,name])=>({value:id,label:name}))} value={module} onChange={value=>{setModule(value);setFunctionId(offered.find(item=>item.moduleId===value)!.id);}}/></div><div className="flow-field"><span>想办理的事</span><FlowSelect label="用户功能" inline={0} options={offered.filter(item=>item.moduleId===module).map(item=>({value:item.id,label:item.title}))} value={functionId} onChange={setFunctionId}/></div><button className="secondary-button" disabled={busy} onClick={()=>void run(functionId)}>开始办理</button></div></details>
  </>}
  {task&&<section className="business-card workflow-card" aria-label="功能办理卡片">
   <div className="card-top"><h2>{businessTitle(task.functionId,task.title)}</h2><button className="text-button" disabled={busy} onClick={()=>void onAction({type:'home'})}>收起</button></div>
   {['blocked','unsupported','external','cancelled'].includes(task.status)&&<p className="card-status">{statusLabel[task.status]}</p>}
   {description&&<p className="card-description" aria-live="polite">{description}</p>}
   {['review','authenticate'].includes(task.status)&&<section className="flow-review" aria-label="执行前核对卡"><dl className="flow-result-fields">{review.map(entry=><div key={entry.key}><dt>{entry.label}</dt><dd>{entry.key==='action'&&entry.value==='assess'?'开始测评':entry.value}</dd></div>)}</dl></section>}
   {editable&&<details className="flow-edit" open={!['review','complete'].includes(task.status)}><summary>{task.status==='complete'?'调整查询':task.status==='review'?'修改信息':'补充信息'}</summary><form onSubmit={event=>{event.preventDefault();const patch=Object.fromEntries(Object.entries(draft).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(task.params[key])));void(task.status==='complete'?run(task.functionId,draft):command({operation:'amend',taskId:task.id,params:patch}));}}><div className="flow-form">{visibleFields.filter(key=>required.includes(key)||Object.hasOwn(task.params,key)).map(field)}</div>{optionalFields.length>0&&<details className="flow-optional"><summary>更多选项</summary><div className="flow-form">{optionalFields.map(field)}</div></details>}<button className="secondary-button" type="submit" disabled={busy||!dirty}>{task.status==='complete'?'重新查询':'保存修改'}</button></form></details>}
   {task.status==='review'&&<button className="primary-button" disabled={busy||dirty} onClick={()=>void command({operation:'confirm',taskId:task.id,token:task.reviewToken!})}>{dirty?'保存后确认':'确认办理'}</button>}
   {task.status==='authenticate'&&<form onSubmit={event=>{event.preventDefault();void command({operation:'authenticate',taskId:task.id,token:task.verificationId!,code});}}><label className="flow-field">验证码<input aria-label="验证码" inputMode="numeric" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} autoComplete="off"/></label><p className="auth-note">验证码 123456</p><button className="primary-button" disabled={busy||code.length!==6}>验证并办理</button><button type="button" className="text-button" disabled={busy} onClick={()=>void command({operation:'amend',taskId:task.id,params:{}})}>返回核对</button></form>}
   {task.status==='blocked'&&<button className="secondary-button" disabled={busy} onClick={()=>void command({operation:'resume',taskId:task.id})}>重试</button>}
   {!!task.limitations?.length&&<aside className="auth-note" aria-label="未完成事项"><ul>{task.limitations.map(reason=><li key={reason}>{userMessage(reason)}</li>)}</ul></aside>}
   {task.result!=null&&task.functionId!=='catalog'&&<div className="flow-result" aria-label="办理结果"><BusinessResult functionId={task.functionId} value={task.result} bank={bank}/></div>}
   {!['complete','cancelled','external','unsupported'].includes(task.status)&&<button className="text-button" disabled={busy} onClick={()=>void command({operation:'cancel',taskId:task.id})}>取消办理</button>}
  </section>}
  {bank.workflows&&bank.workflows.tasks.some(item=>item.id!==task?.id&&['collecting','review','authenticate','blocked'].includes(item.status))&&<details className="flow-pending"><summary>未完成的业务</summary>{bank.workflows.tasks.filter(item=>item.id!==task?.id&&['collecting','review','authenticate','blocked'].includes(item.status)).map(item=><button key={item.id} className="text-button" disabled={busy} onClick={()=>void command({operation:'resume',taskId:item.id})}>继续：{item.title}</button>)}</details>}
 </div>;
}

