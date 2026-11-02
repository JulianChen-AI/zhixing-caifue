import { WORKFLOW_VERSION } from './catalog.ts';
import type { FlowStore } from './types.ts';

export function initialFlowStore(): FlowStore {
  return { version: WORKFLOW_VERSION, tasks: [], currentTaskId: null, riskProfile: null, log: [], records: {
    transactions: [
      {id:'txn-food',date:'2026-10-20',merchant:'校园食堂',category:'餐饮',amount:3200,accountId:'daily',kind:'expense',source:'合成本行流水'},
      {id:'txn-coffee',date:'2026-10-18',merchant:'咖啡店',category:'饮品',amount:2600,accountId:'daily',kind:'expense',source:'合成本行流水'},
      {id:'txn-video',date:'2026-10-15',merchant:'视频会员',category:'订阅',amount:2500,accountId:'daily',kind:'expense',source:'合成本行流水'},
      {id:'txn-video-old',date:'2026-09-15',merchant:'视频会员',category:'订阅',amount:2500,accountId:'daily',kind:'expense',source:'合成本行流水'},
      {id:'txn-refund',date:'2026-10-21',merchant:'校园食堂',category:'餐饮',amount:1200,accountId:'daily',kind:'refund',originalId:'txn-food',source:'合成本行流水'},
      {id:'txn-double',date:'2026-10-20',merchant:'校园食堂',category:'餐饮',amount:3200,accountId:'daily',kind:'expense',suspectedDuplicate:true,source:'合成本行流水'},
    ],
    subscriptions: [
      {id:'sub-video',name:'视频会员',channel:'bank',amount:2500,cycle:'monthly',nextChargeAt:'2026-11-15',benefitUntil:'2026-11-15',status:'active',protected:false,confirmed:true},
      {id:'sub-cloud',name:'云存储',channel:'platform',amount:600,cycle:'monthly',nextChargeAt:'2026-11-03',status:'active',protected:false,confirmed:true},
      {id:'sub-loan',name:'助学贷款还款',channel:'bank',amount:50000,cycle:'monthly',nextChargeAt:'2026-11-05',status:'active',protected:true,confirmed:true},
    ],
    products: [
      {id:'fund-cash',name:'演示现金基金',risk:1,feeRate:0,price:1,type:'货币',liquidity:'沙箱手动推进结算；赎回预计T+1工作日（不含节假日校验），并非即时到账',synthetic:true},
      {id:'fund-bond',name:'演示债券基金',risk:3,feeRate:0,price:1,type:'债券',liquidity:'沙箱手动推进结算；赎回预计T+1工作日（不含节假日校验），并非即时到账',synthetic:true},
    ],
    goals:[{id:'goal-travel',name:'旅行目标',target:300000,balance:0,deadline:'2027-06-01',status:'active'}],
    holdings:[{id:'holding-cash',productId:'fund-cash',name:'演示现金基金',value:20000,cost:20000,accountId:'savings'}],
    cards:[
      {id:'card-daily',name:'日常借记卡',tail:'8021',accountId:'daily',status:'active',restriction:'none',limit:500000,issuer:'本行沙箱'},
      {id:'card-risk',name:'储蓄借记卡',tail:'3609',accountId:'savings',status:'restricted',restriction:'risk',limit:1000000,issuer:'本行沙箱'},
      {id:'card-judicial',name:'司法限制演示卡',tail:'9012',accountId:'daily',status:'restricted',restriction:'judicial',limit:100000,issuer:'本行沙箱'},
    ],
    orders:[], rules:[], reminders:[], cancellations:[], applications:[], replacements:[], bindings:[], budgets:[], contacts:[], relations:[], aa:[], questionnaires:[], education:[], categories:[],
  }};
}
