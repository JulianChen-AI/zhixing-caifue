import type { BankState, Contact } from '../bank/types.ts';
import { WorkflowError, type Row } from '../workflows/types.ts';
import { aaShares } from '../workflows/aa.ts';

export const SCENE_IDS = ['default','S01','S01-R','S02-A','S02-B','S02-C','S02-D','S03','S04','S05','S06','S07','S08','S08-F','S08-U'] as const;
export type SceneId = typeof SCENE_IDS[number];
export const SCENE_VERSION = 'roadshow-20261030-v1';
const source = '路演技术清单：合成快照，非真实业务记录';
const entry = (id:SceneId,label:string,clock:string,assumptions:string[] = []) => ({id,label,clock,source,assumptions});
const manifest: Record<SceneId, ReturnType<typeof entry>> = {
 default:entry('default','默认演示','', ['恢复原默认数据']),
 S01:entry('S01','大一','2026-10-25T04:00:00.000Z',['分类拆笔及具体日期为工程设定']),
 'S01-R':entry('S01-R','大一·取消结果演练','2026-10-25T04:00:00.000Z',['同S01数据','视频A取消结果待核对、视频B被退回、音乐C需到服务方取消，均为模拟结果']),
 'S02-A':entry('S02-A','大二开始','2027-10-25T04:00:00.000Z',['合成前提：此前有往来','聚餐AA尚未发起，现场创建']),
 'S02-B':entry('S02-B','大二转账后','2027-10-25T04:00:00.000Z',['合成前提：此前有往来','聚餐AA尚未发起，现场创建']),
 'S02-C':entry('S02-C','大二次日','2027-10-26T04:00:00.000Z',['合成前提：此前有往来','收款为预置合成历史']),
 'S02-D':entry('S02-D','大二收齐','2027-10-27T04:00:00.000Z',['合成前提：此前有往来','收款为预置合成历史']),
 S03:entry('S03','大三','2028-10-25T04:00:00.000Z',['未预置申购或资金占用']),
 S04:entry('S04','大四','2030-06-25T04:00:00.000Z',['场景由任务书补充','云空间仅有流水，不代表已知代扣协议','活期1,500元为工程设定']),
 S05:entry('S05','研一','2031-03-25T04:00:00.000Z',['规则已保存，首次执行为2031-04-01；推进演示时间时由模拟调度执行','活期4,000元、房租每月1日1,500元为工程设定']),
 S06:entry('S06','研二','2032-03-25T04:00:00.000Z',['场景由任务书补充','预算需用户输入','活期3,000元为工程设定']),
 S07:entry('S07','研三','2033-03-25T04:00:00.000Z',['24笔目标储蓄为合成历史','李明未保存、未曾使用']),
 S08:entry('S08','入职','2033-07-25T04:00:00.000Z',['月度安排是模板，不是已执行的计划','合成前提：研三押金已到账，属已往来收款人','应急金目标额10,000元为工程设定','测评为演示用合成记录，不代表真实适当性认证']),
 'S08-F':entry('S08-F','入职·储蓄失败演练','2033-07-25T04:00:00.000Z',['同S08合成前提与工程设定','演练：储蓄首个已授权请求失败，重试只处理该项，非真实通道']),
 'S08-U':entry('S08-U','入职·房租待核对演练','2033-07-25T04:00:00.000Z',['同S08合成前提与工程设定','演练：房租原订单结果未知，不再创建第二笔，非真实通道']),
};
export const SCENE_MANIFEST = SCENE_IDS.map(id=>manifest[id]);
const contacts:(Contact & {accountRef:string})[] = [
 {id:'C01',accountRef:'ZS-CLASS-0186',name:'张三',label:'同班',bank:'模拟银行',tail:'0186',color:'blue',previouslyUsed:true,aliases:{names:['zhang san'],labels:['同班','同班同学']}},
 {id:'C02',accountRef:'ZS-BADM-7291',name:'张三',label:'羽毛球社',bank:'模拟银行',tail:'7291',color:'violet',previouslyUsed:true,aliases:{names:['zhang san'],labels:['羽毛球','打羽毛球','羽毛球社']}},
 {id:'C03',accountRef:'ZS-CLUB-5408',name:'张三',label:'社团学长',bank:'模拟银行',tail:'5408',color:'mint',previouslyUsed:true,aliases:{names:['zhang san'],labels:['社团学长','学长','社团']}},
];
const row=(id:string, data:Record<string,unknown>):Row=>({id,...data,source:'路演合成数据',synthetic:true});
const txn=(id:string,date:string,amount:number,kind:string,merchant:string,category:string):Row=>row(id,{date,amount,kind,merchant,category,accountId:'daily'});
function fresh(baseState:BankState):BankState {
 const s=structuredClone(baseState); if(!s.workflows)throw new Error('场景构造需要基础工作流数据。');
 delete s.monthlyHistory;
 s.routing=null;s.checklist=null;s.task=null;s.plan=null;s.receipts=[];s.audit=[];s.view='home';s.lastReply='你好，今天想办点什么？';s.recentRequestIds=[];
 s.workflows.tasks=[];s.workflows.currentTaskId=null;s.workflows.riskProfile=null;s.workflows.log=[];
 for(const k of Object.keys(s.workflows.records))s.workflows.records[k]=[];
 s.accounts=[{id:'daily',name:'日常账户',tail:'8021',balance:0}];s.contacts=[];
 s.workflows.records.cards=[row('card-daily',{name:'日常借记卡',tail:'8021',accountId:'daily',status:'active',restriction:'none',limit:500000,issuer:'模拟银行'})];
 return s;
}
const goal=(balance:number)=>row('TRIP-01',{name:'下次一定去',target:240000,balance,deadline:'2033-03-31',status:'active'});
const rule=()=>row('trip-rule',{kind:'goal',goalId:'TRIP-01',accountId:'daily',amount:10000,schedule:'每月1日',startDate:'2031-04-01',stopAtTarget:true,status:'active',execution:'推进演示时间时由模拟调度执行，余额不足则本期不执行'});

/** Build only synthetic fixtures. The caller supplies a pristine default state. */
export function buildScene(sceneId:string,baseState:BankState):BankState {
 if(!(SCENE_IDS as readonly string[]).includes(sceneId))throw new WorkflowError('未知路演场景：'+sceneId,400);
 if(sceneId==='default'){const s=structuredClone(baseState) as BankState & {sceneId?:string;sceneVersion?:string;demoClock?:string};delete s.sceneId;delete s.sceneVersion;delete s.demoClock;return s;}
 const id=sceneId as SceneId,s=fresh(baseState) as BankState & {sceneId?:string;sceneVersion?:string;demoClock?:string},r=s.workflows!.records;
 s.sceneId=id;s.sceneVersion=SCENE_VERSION;s.demoClock=manifest[id].clock;
 const setBalance=(amount:number)=>{s.accounts[0].balance=amount;};
 if(id==='S01'||id==='S01-R'){
  setBalance(28660);
  r.transactions=[txn('income','2026-10-01',200000,'income','生活费','收入'),...Array.from({length:20},(_,i)=>txn(`food-${i+1}`,'2026-10-05',4100,'expense','校园餐饮','餐饮')),...Array.from({length:12},(_,i)=>txn(`travel-${i+1}`,'2026-10-06',1000,'expense','交通','交通')),...Array.from({length:4},(_,i)=>txn(`supplies-${i+1}`,'2026-10-07',6500,'expense','日用品','日用品')),...Array.from({length:2},(_,i)=>txn(`books-${i+1}`,'2026-10-08',10000,'expense','书籍','书籍')),...Array.from({length:26},(_,i)=>txn(`coffee-${String(i+1).padStart(2,'0')}`,'2026-10-'+String(i%24+1).padStart(2,'0'),990,'expense','咖啡','咖啡')),...['08','09','10'].flatMap(month=>[txn('video-a-'+month,`2026-${month}-15`,2500,'expense','视频A','订阅'),txn('video-b-'+month,`2026-${month}-16`,3100,'expense','视频B','订阅')])];
  r.subscriptions=['A','B'].map((suffix,i)=>row('video-'+suffix.toLowerCase(),{name:'视频'+suffix,channel:'bank',amount:i?3100:2500,cycle:'monthly',nextChargeAt:'2026-11-'+(i?'16':'15'),benefitUntil:'2026-11-'+(i?'16':'15'),status:'active',protected:false,confirmed:true}));
  if(id==='S01-R'){r.subscriptions[0].cancelOutcome='pending';r.subscriptions[1].cancelOutcome='failure';r.subscriptions.push(row('music-c',{name:'音乐C',channel:'platform',amount:1500,cycle:'monthly',nextChargeAt:'2026-11-20',benefitUntil:'2026-11-20',status:'active',protected:false,confirmed:true}));}
 } else if(id.startsWith('S02-')){
  s.contacts=structuredClone(contacts);const stage=['S02-A','S02-B','S02-C','S02-D'].indexOf(id);setBalance([114000,102000,121000,133000][stage]);
  r.transactions=[txn('opening','2027-10-01',150000,'income','期初资金','收入'),txn('meal','2027-10-24',36000,'expense','聚餐','餐饮')];
  if(stage>=2){const plan=aaShares(36000,['我','张三','林悦','周扬','陈宁','许然'],[{label:'饮料',amount:60,participants:['张三','林悦','周扬']}]),paid=(name:string)=>stage===3||['张三','林悦','陈宁'].includes(name);
   const participants=plan.shares.map(share=>({...share,...(share.name==='张三'?{contactId:'C02'}:{}),status:share.payer?'self':paid(share.name)?'paid':'unpaid'})),received=participants.filter(x=>x.status==='paid').reduce((n,x)=>n+x.amount,0);
   r.aa=[row('AA-01',{status:stage===3?'collected':'awaiting_payment',total:36000,sourceTransactionId:'meal',participants,receivable:plan.receivable,received,outstanding:plan.receivable-received,rule:plan.rule,createdAt:'2027-10-25T04:00:00.000Z',notice:'预置合成收款历史'})];}
  if(stage>0){s.receipts=[{id:'synthetic-transfer-c02',taskId:'synthetic-task-c02',recipientId:'C02',accountId:'daily',amount:12000,note:'球场费',createdAt:'2027-10-25T04:00:00.000Z'}];r.transactions.push(txn('synthetic-transfer-c02','2027-10-25',12000,'expense','张三','转账'));}
  if(stage>=2)r.transactions.push(...[['张三（羽毛球社）',7000],['林悦',7000],['陈宁',5000]].map(([name,amount],i)=>txn('aa-received-'+i,'2027-10-26',Number(amount),'income',String(name),'AA收款')));
  if(stage===3)r.transactions.push(...[['周扬',7000],['许然',5000]].map(([name,amount],i)=>txn('aa-final-'+i,'2027-10-27',Number(amount),'income',String(name),'AA收款')));
 } else if(id==='S03'){
  setBalance(300000);r.transactions=[txn('internship','2028-10-01',300000,'income','实习收入','收入')];r.budgets=[row('rent-budget',{name:'房租预算',amount:120000}),row('living-budget',{name:'生活预算',amount:100000})];
  r.products=[row('product-a',{name:'模拟产品A',risk:2,feeRate:0,price:1,type:'模拟产品',liquidity:'模拟处理，非即时到账',processingTime:'沙箱手动结算'})];
  s.workflows!.riskProfile={level:3,answers:[3,3,3],validUntil:'2029-10-25T04:00:00.000Z'};r.questionnaires=[row('synthetic-risk',{level:3,answers:[3,3,3],createdAt:'2028-10-24T04:00:00.000Z',label:'演示用合成测评'})];
 } else if(id==='S04'){
  setBalance(150000);r.cards.push(row('card-cloud',{name:'另一张模拟卡',tail:'3610',accountId:'daily',status:'active',restriction:'none',limit:500000,issuer:'模拟银行'}));r.transactions=['04','05','06'].map(month=>({...txn('cloud-'+month,`2030-${month}-03`,1200,'expense','云空间','订阅'),cardId:'card-cloud'}));
  r.subscriptions=['A','B'].map(suffix=>row('video-'+suffix.toLowerCase(),{name:'视频'+suffix,channel:'bank',status:'cancelled',protected:false,confirmed:true}));
 } else if(id==='S05'||id==='S07'){
  r.goals=[goal(id==='S07'?240000:0)];r.rules=[rule()];
  if(id==='S05'){setBalance(400000);r.budgets=[row('rent-budget',{name:'房租',amount:150000,date:'每月1日',source:'用户登记'}),row('living-budget',{name:'日常预算',source:'用户登记'})];}
  else {setBalance(510000);s.contacts=[{id:'RENT-7742',name:'李明',label:'房东（用户备注）',bank:'模拟银行',tail:'7742',color:'blue',previouslyUsed:false}];r.transactions=Array.from({length:24},(_,i)=>txn(`trip-deposit-${String(i+1).padStart(2,'0')}`,`${2031+Math.floor((i+3)/12)}-${String((i+3)%12+1).padStart(2,'0')}-01`,10000,'internal_transfer','目标储蓄','内部转存')).map(x=>({...x,goalId:'TRIP-01'}));r.rules[0].status='completed';}
 } else if(id==='S06'){
  setBalance(300000);
 } else if(id==='S08'||id==='S08-F'||id==='S08-U'){
  setBalance(800000);
  s.contacts=[{id:'RENT-7742',accountRef:'RENT-7742',name:'李明',label:'房东（用户备注）',bank:'模拟银行',tail:'7742',color:'blue',previouslyUsed:true}];
  r.goals=[row('EMERGENCY-01',{name:'应急金',target:1000000,balance:0,status:'active',notice:'目标额10,000元为工程设定'})];
  r.products=[row('product-a',{name:'模拟产品A',risk:2,feeRate:0,price:1,type:'模拟产品',liquidity:'模拟处理，非即时到账',processingTime:'沙箱手动结算'})];
  s.workflows!.riskProfile={level:3,answers:[3,3,3],validUntil:'2034-07-25T04:00:00.000Z'};
  r.questionnaires=[row('synthetic-risk',{level:3,answers:[3,3,3],createdAt:'2033-07-24T04:00:00.000Z',label:'演示用合成测评'})];
  r.transactions=[txn('salary','2033-07-01',800000,'income','模拟工资','收入')];
  r.rules=[row('monthly-template',{kind:'monthly_template',name:'月度计划模板',accountId:'daily',recipientId:'RENT-7742',goalId:'EMERGENCY-01',productId:'product-a',rent:180000,savings:40000,investment:20000,report:true,status:'template',execution:'待用户核对，未执行'})];
 }
 return s;
}
