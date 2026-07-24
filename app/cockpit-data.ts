export type CockpitRow={id:string;quarter:string;region:string;accountSet:string;owner:string;customer:string;companyReceivable:number;customerBook:number;difference:number;transit:number;returned:number;otherInvoice:number;otherNoInvoice:number;badDebt:number;adjustment:number;filled:boolean;cleared:boolean;cause:string;followStatus:string;solution:string;expectedDate:string;actualDate?:string;updatedAt:string;transitInvoiceFail?:boolean;returnInvoiceFail?:boolean;consecutiveUnclear?:boolean;duplicateInvoice?:boolean};
const regions=["南京","南通","无锡","扬州","泰州","苏州"],owners=["李小明","王芳","陈强","刘洋","赵蕾","张敏"];
const urgent=[
  ["南京","华东医疗","李小明","南京华联电子有限公司",512300,220000,0,102300,190000,"客户暂未回传账单","待资料","销售补齐对账单并核实在途发票","2026-05-20",1,0,1,0],
  ["南通","华东医疗","王芳","南通海力机械制造有限公司",386600,150000,72600,64000,100000,"退货票与红冲单未匹配","待跟进","出具签收单与客户确认退货金额","2026-05-25",0,1,1,0],
  ["无锡","工业客户","陈强","无锡国胜科技有限公司",245400,90000,0,55400,100000,"客户账套待切换","待财务复核","财务复核系统切换前后余额","2026-05-28",1,0,0,0],
  ["扬州","华东医疗","刘洋","扬州宏远电器有限公司",186400,0,86400,0,100000,"二月退货票缺失","待跟进","补开退货红字发票","2026-05-30",0,1,1,0],
  ["苏州","华东医疗","张敏","苏州天宇精密制造有限公司",168700,70000,0,28700,70000,"客户未确认在途货款","待跟进","取得客户确认函","2026-06-05",1,0,0,0],
  ["泰州","工业客户","赵蕾","泰兴市人民医院",206400,70000,0,36400,0,"历史坏账待审批","待财务复核","提交坏账核销审批单","2026-06-10",0,0,1,0,100000],
  ["南京","华东医疗","李小明","南京医科大学第二附属医院",154300,50000,0,44300,60000,"对账资料尚未齐备","待资料","客户提供账龄明细","2026-06-02",0,0,0,1],
  ["南通","工业客户","王芳","南通海岳商贸有限公司",125800,30000,30000,25800,40000,"其他无票金额偏高","待资料","","2026-05-16",0,0,1,0],
  ["无锡","华东医疗","陈强","无锡博健医疗器械有限公司",115000,25000,20000,30000,40000,"发票号码重复","待财务复核","财务核验发票真伪","2026-06-12",0,0,0,1],
  ["扬州","工业客户","刘洋","扬州盛达有限公司",90000,20000,10000,20000,40000,"金额未完全匹配","待跟进","","2026-06-08",0,0,0,0],
  ["泰州","华东医疗","赵蕾","泰州润达供应链有限公司",78200,18200,10000,0,50000,"无票差额待确认","待资料","催收发票及入库记录","2026-06-15",0,0,0,0],
  ["苏州","工业客户","张敏","苏州瑞康商贸有限公司",71200,11200,10000,0,50000,"调账申请未完成","待跟进","发起调账流程","2026-06-18",0,0,0,0],
  ["南京","工业客户","李小明","南京恒瑞商贸有限公司",56000,6000,10000,0,40000,"客户对账单待盖章","待资料","","2026-06-20",0,0,0,0],
  ["南通","华东医疗","王芳","南通康源医疗有限公司",43800,3800,10000,0,30000,"未收到客户回函","待资料","再次发送对账函","2026-06-21",0,0,0,0],
  ["无锡","工业客户","陈强","无锡嘉禾设备有限公司",39200,9200,10000,0,20000,"客户余额差异","待跟进","核对发货明细","2026-06-22",0,0,0,0],
  ["苏州","华东医疗","张敏","苏州广济医院",31000,1000,10000,0,20000,"其他无票待确认","待资料","补齐费用归属单","2026-06-25",0,0,0,0],
  ["泰州","工业客户","赵蕾","泰州新城实业有限公司",21800,1800,0,0,20000,"暂估入账未冲回","待财务复核","财务确认暂估冲回","2026-06-28",0,0,0,0]
] as const;
const row=(x:typeof urgent[number],i:number):CockpitRow=>({id:`q2-${i}`,quarter:"2026 Q2",region:x[0],accountSet:x[1],owner:x[2],customer:x[3],companyReceivable:x[4],customerBook:0,difference:x[4],transit:x[5],returned:x[6],otherInvoice:x[7],otherNoInvoice:x[8],badDebt:x[16]||0,adjustment:0,filled:i!==6&&i!==7,cleared:false,cause:x[9],followStatus:x[10],solution:x[11],expectedDate:x[12],updatedAt:"2026-05-19 10:30",transitInvoiceFail:!!x[13],returnInvoiceFail:!!x[14],consecutiveUnclear:!!x[15],duplicateInvoice:i===8});
const normal=(quarter:string,i:number):CockpitRow=>{const reg=regions[i%6],diff=quarter==="2026 Q1"&&i<25?35000+(i%5)*8000:0;return{id:`${quarter}-${i}`,quarter,region:reg,accountSet:i%2?"华东医疗":"工业客户",owner:owners[i%6],customer:`${reg}${quarter==="2026 Q1"?"一季度":"客户服务"}中心${String(i+1).padStart(3,"0")}`,companyReceivable:80000+(i%9)*7300,customerBook:80000+(i%9)*7300-diff,difference:diff,transit:diff,returned:0,otherInvoice:0,otherNoInvoice:0,badDebt:0,adjustment:0,filled:true,cleared:!diff,cause:diff?"季度资料待补":"账实一致",followStatus:diff?"待跟进":"已解决",solution:diff?"推进客户确认":"已归档",expectedDate:quarter==="2026 Q1"?"2026-03-28":"2026-05-15",actualDate:diff?undefined:"2026-05-15",updatedAt:"2026-05-15 09:00",consecutiveUnclear:!!diff&&i%3===0}};
export const cockpitRows=[...urgent.map(row),...Array.from({length:111},(_,i)=>normal("2026 Q2",i)),...Array.from({length:120},(_,i)=>normal("2026 Q1",i))];
export const trendData=[{quarter:"2025 Q3",rate:75.8,unresolved:4210500},{quarter:"2025 Q4",rate:79.6,unresolved:3912300},{quarter:"2026 Q1",rate:82.5,unresolved:3758400},{quarter:"2026 Q2",rate:86.7,unresolved:3286000}];
