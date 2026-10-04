import React from 'react';
import {AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame} from 'remotion';
import demoJson from '../public/data/demo-data.json';
import {FPS} from './root';
import {anim, Backplane, C, Dot, easeCamera, easeFast, FONT, GlassCard, Headline, Kicker, money, PhotoPlane} from './visual';

type FilmOrder = {
  id: string; custom_order_no: string; total_price: number; tip: number;
  final_club_income: number; assigned_worker_ids: string[];
  worker_order_earnings: Record<string, number>;
  worker_tip_earnings: Record<string, number>;
  pricing_snapshot: {service_name: string; club_commission_rate: number; split_type: string; payout_weights: Array<{workerId: string; workerName: string; weight: number}>};
};
type Demo = {
  sourceCommit: string;
  order: FilmOrder;
  menuItem: {service_name: string; base_price: number; club_commission_rate: number; split_type: string};
  settlementRecord: {total_amount: number; total_orders: number; worker_name_snapshot: string};
  dashboard: {completedOrders: number; clubIncome: number; wageExpense: number; instantTips: number; dailyClubIncome: Array<[string, number]>; workerOrderCounts: Array<{id: string; name: string; count: number}>};
};
const data = demoJson as unknown as Demo;
const order = data.order;
const people = order.pricing_snapshot.payout_weights;
const unitShare = order.total_price / people.length;

const sceneDefs = [
  {name: 'OPENING', start: 0, end: 10, scene: Opening},
  {name: 'EVOLUTION', start: 10, end: 28, scene: Evolution},
  {name: 'SYSTEM', start: 28, end: 42, scene: System},
  {name: 'PRICE', start: 42, end: 56, scene: Price},
  {name: 'ORDER', start: 56, end: 68, scene: Order},
  {name: 'ASSIGNMENT', start: 68, end: 83, scene: Assignment},
  {name: 'EXECUTION', start: 83, end: 93, scene: Execution},
  {name: 'SETTLEMENT', start: 93, end: 119, scene: Settlement},
  {name: 'WAGE PERIOD', start: 119, end: 135, scene: Wage},
  {name: 'DATA', start: 135, end: 150, scene: Dashboard},
  {name: 'MODULES', start: 150, end: 160, scene: Modules},
  {name: 'CLOSING', start: 160, end: 168, scene: Closing},
] as const;

type SceneProps = {f: number; globalFrame: number};
const insetCaption: React.CSSProperties = {position: 'absolute', left: 112, bottom: 78, fontSize: 17, color: C.mute, letterSpacing: 1};
const numberStyle: React.CSSProperties = {fontVariantNumeric: 'tabular-nums', letterSpacing: -4, fontWeight: 750};

const FineLine: React.FC<{d: string; progress: number; color?: string; width?: number; opacity?: number}> = ({d, progress, color=C.blue, width=2, opacity=1}) => (
  <path d={d} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray="1" strokeDashoffset={1 - progress} pathLength="1" fill="none" opacity={opacity} />
);

const DemoTag: React.FC = () => (
  <div style={{position: 'absolute', right: 102, top: 80, padding: '10px 16px', borderRadius: 30, border: '1px solid rgba(100,210,255,.26)', background: 'rgba(0,122,255,.08)', color: C.cyan, fontSize: 14, letterSpacing: 2, fontWeight: 700}}>LOCAL DEMO DATA</div>
);

const AnimatedAmount: React.FC<{value: number; f: number; at: number; duration?: number; decimals?: number; style?: React.CSSProperties}> = ({value,f,at,duration=48,decimals=0,style}) => (
  <span style={{...numberStyle, ...style}}>{money(Math.round(anim(f, at, duration, 0, value) * 100) / 100, decimals)}</span>
);

function Opening({f}: SceneProps) {
  const dotX = anim(f, 70, 370, 295, 1600, easeCamera);
  const intoUI = anim(f, 485, 115, 1, 1.75, easeCamera);
  const nodes = ['PRICE', 'PLAYER', 'ORDER', 'SETTLEMENT', 'WAGE', 'DATA'];
  return <AbsoluteFill>
    <Backplane frame={f} />
    <div style={{position: 'absolute', top: 212, left: 180, fontSize: 44, color: C.white, opacity: anim(f, 20, 42) * (1 - anim(f, 305, 48)), fontWeight: 550, letterSpacing: 1}}>一笔订单，会经过多少个步骤？</div>
    <svg width="1920" height="1080" style={{position: 'absolute', transform: `scale(${intoUI})`, transformOrigin: '960px 570px'}}>
      <FineLine d="M 292 570 H 1638" progress={anim(f, 80, 360)} color={C.cyan} width={2} opacity={0.65} />
      {nodes.map((label,i) => {
        const x=310+i*262; const enter=anim(f, 80+i*55, 42);
        return <g key={label} opacity={enter}>
          <Dot x={x} y={570} r={i===2?10:7} color={i===2?C.blue:C.cyan} pulse={Math.sin((f+i*29)/34)*0.5+0.5}/>
          <text x={x} y={617} textAnchor="middle" fill={C.mute} fontFamily={FONT} fontSize="21" letterSpacing="3">{label}</text>
        </g>;
      })}
      <Dot x={dotX} y={570} r={10} color={C.blue} pulse={0.7}/>
    </svg>
    <div style={{position:'absolute', left:110, top:710, opacity:anim(f,392,50), transform:`translateY(${anim(f,392,50,45,0)}px)`}}>
      <div style={{fontSize:29,color:C.cyan,letterSpacing:8}}>日晖俱乐部</div>
      <div style={{fontSize:75,fontWeight:780,color:C.white,letterSpacing:-2,marginTop:9}}>DELTA FORCE CLUB HUB</div>
      <div style={{fontSize:23,color:C.mute,marginTop:11}}>从一笔订单，到一次完整结算。</div>
    </div>
  </AbsoluteFill>;
}

const history = [
  {sha:'242c052',date:'09.09',title:'首版六面工作台',diff:'+ dashboard + orders + workers'},
  {sha:'516d8ab',date:'09.09',title:'管理动作',diff:'+ updateWorker + orderActions'},
  {sha:'22d2572',date:'09.10',title:'新增服务与打手',diff:'+ AddServiceModal'},
  {sha:'c8e86dd',date:'09.11',title:'档位抽成 / 特殊需求',diff:'+ tierCommission + extras'},
  {sha:'2009148',date:'09.12',title:'逐人打赏',diff:'+ tipsByWorker'},
  {sha:'e2ba35c',date:'09.12',title:'小时陪玩单',diff:'+ hourlyRate × hours'},
  {sha:'879f7e9',date:'09.12',title:'排序与文件夹',diff:'+ folder + sortOrder'},
  {sha:'5725f49',date:'09.14',title:'独立工资结算',diff:'+ settlementRecord'},
  {sha:'0df2f9d',date:'09.26',title:'工资 / 打赏拆账',diff:'+ workerOrderEarnings'},
  {sha:'c1bb5d5',date:'09.29',title:'多次换人留痕',diff:'+ transferFees[]'},
  {sha:'9625ea4',date:'10.01',title:'临时价格与展示时间',diff:'+ orderSnapshot'},
];
function Evolution({f}: SceneProps) {
  const scroll = anim(f, 30, 985, 0, -1770, easeCamera);
  return <AbsoluteFill>
    <Backplane frame={f} />
    <Kicker>PROJECT EVOLUTION / VERIFIED GIT HISTORY</Kicker>
    <Headline y={151} size={64}>需求出现，系统生长。</Headline>
    <div style={{position:'absolute',left:108,top:256,color:C.mute,fontSize:23}}>从 2026.09.09 的首版，到 2026.10.01 的完整经营视图。</div>
    <div style={{position:'absolute',left:0,top:0,transform:`translateX(${scroll}px)`}}>
      <svg width="3800" height="1080" style={{position:'absolute'}}>
        <FineLine d="M 170 629 H 3660" progress={anim(f,20,900)} color={C.blue} width={3} opacity={0.8}/>
        {history.map((h,i) => <Dot key={h.sha} x={235+i*320} y={629} r={9} color={i<3?C.cyan:i<8?C.blue:C.green} pulse={Math.sin((f-i*65)/38)*0.5+0.5}/>)}</svg>
      {history.map((h,i) => {
        const x=145+i*320; const visible=anim(f,30+i*71,37);
        return <div key={h.sha} style={{position:'absolute',left:x,top:i%2===0?394:688,width:270,opacity:visible,transform:`translateY(${(1-visible)*(i%2===0?30:-30)}px)`}}>
          <div style={{fontSize:17,color:C.cyan,letterSpacing:2}}>{h.date} · {h.sha}</div>
          <div style={{fontSize:28,color:C.white,fontWeight:700,marginTop:16,lineHeight:1.25}}>{h.title}</div>
          <div style={{fontSize:15,color:C.mute,marginTop:14,fontFamily:'Consolas, monospace'}}>{h.diff}</div>
        </div>;
      })}
    </div>
    <div style={{...insetCaption}}>每一个节点都有真实提交与源码差异可追溯。</div>
  </AbsoluteFill>;
}

const moduleNodes = [
  {label:'总览',kind:'DATA',x:420,y:348}, {label:'接单台',kind:'ENTRY',x:822,y:286},
  {label:'打手看板',kind:'PEOPLE',x:1436,y:348}, {label:'价格表',kind:'RULES',x:420,y:745},
  {label:'订单结算',kind:'CALC',x:1130,y:790}, {label:'工资结算',kind:'CYCLE',x:1500,y:735},
];
function System({f}: SceneProps) {
  const orbit=anim(f,28,370);
  return <AbsoluteFill>
    <Backplane frame={f}/><Kicker>SYSTEM OVERVIEW</Kicker><Headline>一笔订单，连接整个后台。</Headline>
    <PhotoPlane file="01-overview-before.jpg" left={540} top={237} width={875} height={492} imageScale={0.456} opacity={0.22+orbit*.16} scale={0.92+orbit*.06}/>
    <svg width="1920" height="1080" style={{position:'absolute'}}>
      {moduleNodes.map((m,i)=><FineLine key={m.label} d={`M 958 535 L ${m.x} ${m.y}`} progress={anim(f,90+i*43,125)} color={C.cyan} width={2} opacity={0.56}/>)}
      <Dot x={958} y={535} r={18} pulse={Math.sin(f/26)*0.5+0.5}/>
    </svg>
    <GlassCard style={{position:'absolute',left:805,top:464,width:306,height:141,padding:'30px 33px',textAlign:'center',transform:`scale(${anim(f,45,65,0.76,1)})`}}>
      <div style={{color:C.cyan,fontSize:16,letterSpacing:3}}>SINGLE SOURCE</div><div style={{color:C.white,fontSize:30,fontWeight:750,marginTop:9}}>ORDER CORE</div>
    </GlassCard>
    {moduleNodes.map((m,i)=><GlassCard key={m.label} style={{position:'absolute',left:m.x-111,top:m.y-48,width:224,height:96,padding:'19px 23px',opacity:anim(f,80+i*37,45),transform:`scale(${anim(f,80+i*37,45,0.82,1)})`}}>
      <div style={{fontSize:14,letterSpacing:2,color:C.cyan}}>{m.kind}</div><div style={{fontSize:24,fontWeight:700,color:C.white,marginTop:7}}>{m.label}</div>
    </GlassCard>)}
  </AbsoluteFill>;
}

function Price({f}: SceneProps) {
  const lift=anim(f,115,105);
  return <AbsoluteFill>
    <Backplane frame={f}/><DemoTag/><Kicker>STEP 01 / PRICE</Kicker><Headline>先定义规则。</Headline>
    <PhotoPlane file="02-pricing.jpg" left={95} top={298} width={1120} height={630} imageScale={0.583} opacity={anim(f,0,55,0.38,0.91)} scale={anim(f,0,80,0.94,1)}/>
    <div style={{position:'absolute',left:940,top:380,opacity:lift,transform:`translate(${anim(f,115,105,150,0)}px, ${anim(f,115,105,58,0)}px) scale(${anim(f,115,105,0.86,1)})`}}>
      <GlassCard style={{width:794,height:494,padding:44,borderColor:'rgba(100,210,255,.34)'}}>
        <div style={{fontSize:19,color:C.cyan,letterSpacing:3}}>PRICE RULE / menu-equal</div>
        <div style={{fontSize:42,color:C.white,fontWeight:750,marginTop:22}}>{data.menuItem.service_name}</div>
        <div style={{fontSize:96,color:C.white,marginTop:21,...numberStyle}}>{money(data.menuItem.base_price)}</div>
        <div style={{height:1,background:C.line,margin:'22px 0 29px'}}/>
        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
          {['护航 / 固定价',`统一抽成 ${data.menuItem.club_commission_rate}%`,'两人平分 / 50 : 50','可接档位'].map((tag,i)=><span key={tag} style={{padding:'12px 15px',borderRadius:11,color:i===1?C.cyan:C.white,background:i===1?'rgba(0,122,255,.16)':'rgba(255,255,255,.07)',fontSize:19}}>{tag}</span>)}
        </div>
      </GlassCard>
    </div>
    <div style={{...insetCaption}}>服务规则在下单时冻结，后续修改价格表不会回写这笔订单。</div>
  </AbsoluteFill>;
}

function Order({f}: SceneProps) {
  const modal=anim(f,125,85);
  const token=anim(f,325,220);
  return <AbsoluteFill>
    <Backplane frame={f}/><DemoTag/><Kicker>STEP 02 / ORDER</Kicker><Headline>规则成为订单。</Headline>
    <PhotoPlane file="03-order-desk.jpg" left={113} top={278} width={1197} height={674} imageScale={0.624} opacity={1-modal*.65} scale={1-modal*.06}/>
    <PhotoPlane file="04-order-confirm.jpg" left={590} top={207} width={834} height={718} imageScale={0.77} imageX={-474} imageY={-22} opacity={modal} scale={anim(f,125,85,0.87,1)}/>
    <GlassCard style={{position:'absolute',left:456,top:805,width:1007,padding:'31px 38px',opacity:token,transform:`translateY(${anim(f,325,220,67,0)}px)`}}>
      <div style={{color:C.mute,fontSize:17,letterSpacing:3}}>IMMUTABLE ORDER SNAPSHOT</div>
      <div style={{color:C.blue,fontSize:66,fontWeight:750,marginTop:10,fontVariantNumeric:'tabular-nums'}}>{order.custom_order_no}</div>
    </GlassCard>
  </AbsoluteFill>;
}

function Assignment({f}: SceneProps) {
  const lock=anim(f,465,110);
  return <AbsoluteFill>
    <Backplane frame={f}/><DemoTag/><Kicker>STEP 03 / ASSIGNMENT</Kicker><Headline>订单与人员建立关系。</Headline>
    <svg width="1920" height="1080" style={{position:'absolute'}}>
      <FineLine d="M 960 601 C 810 601 762 467 588 467" progress={anim(f,180,200)} color={C.cyan} width={3}/>
      <FineLine d="M 960 601 C 1110 601 1158 467 1332 467" progress={anim(f,245,200)} color={C.cyan} width={3}/>
      <Dot x={960} y={601} r={14} pulse={Math.sin(f/28)*.5+.5}/>
    </svg>
    {people.map((person,i)=>{
      const x=i===0?252:1080;const enter=anim(f,100+i*130,83);
      return <GlassCard key={person.workerId} style={{position:'absolute',left:x,top:379,width:465,height:244,padding:'34px 38px',opacity:enter,transform:`translateX(${anim(f,100+i*130,83,i===0?-100:100,0)}px)`,borderColor:lock>.5?'rgba(48,209,88,.35)':undefined}}>
        <div style={{fontSize:17,color:C.mute,letterSpacing:3}}>PLAYER 0{i+1} / {person.weight}%</div>
        <div style={{fontSize:52,fontWeight:750,color:C.white,marginTop:17}}>{person.workerName}</div>
        <div style={{display:'flex',gap:15,alignItems:'center',marginTop:19,fontSize:23,color:lock>.5?C.orange:C.green}}>
          <span style={{width:12,height:12,borderRadius:99,background:'currentColor',boxShadow:'0 0 20px currentColor'}}/>
          {lock>.5?'接单中':'空闲'}
        </div>
      </GlassCard>;
    })}
    <GlassCard style={{position:'absolute',left:806,top:550,width:310,height:135,padding:'27px 28px',textAlign:'center',transform:`scale(${anim(f,65,100,.7,1)})`,borderColor:'rgba(0,122,255,.48)'}}>
      <div style={{color:C.cyan,fontSize:17,letterSpacing:2}}>{order.custom_order_no}</div>
      <div style={{color:lock>.5?C.orange:C.white,fontSize:27,fontWeight:750,marginTop:13}}>{lock>.5?'ACTIVE / 进行中':'ORDER / 待分配'}</div>
    </GlassCard>
    <div style={{...insetCaption}}>两名演示打手由真实页面选定；服务端同步锁定其空闲状态。</div>
  </AbsoluteFill>;
}

function Execution({f}: SceneProps) {
  const names=['接单台','打手看板','订单与结算'];
  const files=['03-order-desk.jpg','05-workforce-active.jpg','06-order-active.jpg'];
  return <AbsoluteFill>
    <Backplane frame={f}/><DemoTag/><Kicker>STEP 04 / EXECUTION</Kicker><Headline>同一对象，驱动三个界面。</Headline>
    <svg width="1920" height="1080" style={{position:'absolute'}}>
      <FineLine d="M 220 791 H 1700" progress={anim(f,170,230)} color={C.cyan} width={3} opacity={.7}/>
      {[426,960,1494].map((x,i)=><Dot key={x} x={x} y={791} r={9} color={i===1?C.blue:C.cyan} pulse={Math.sin((f-i*28)/35)*.5+.5}/>)}
    </svg>
    {files.map((file,i)=><div key={file} style={{position:'absolute',left:160+i*534,top:342,opacity:anim(f,35+i*77,70),transform:`translateY(${anim(f,35+i*77,70,80,0)}px)`}}>
      <PhotoPlane file={file} left={0} top={0} width={525} height={360} imageScale={.36} imageX={-88} imageY={-10}/>
      <div style={{position:'absolute',left:24,top:381,fontSize:24,color:C.white,fontWeight:700}}>{names[i]}</div>
    </div>)}
    <div style={{position:'absolute',left:733,top:827,color:C.cyan,fontSize:31,letterSpacing:2,fontWeight:700}}>{order.custom_order_no}</div>
  </AbsoluteFill>;
}

function Settlement({f}: SceneProps) {
  const split=anim(f,180,140);
  const deducted=anim(f,480,155);
  const tips=anim(f,960,250);
  const personA=people[0],personB=people[1];
  const wageA=order.worker_order_earnings[personA.workerId];
  const wageB=order.worker_order_earnings[personB.workerId];
  const tipA=order.worker_tip_earnings[personA.workerId];
  const tipB=order.worker_tip_earnings[personB.workerId];
  return <AbsoluteFill>
    <Backplane frame={f} glow={C.cyan}/><DemoTag/><Kicker>STEP 05 / SETTLEMENT</Kicker>
    <Headline size={64} y={149}>每一笔钱，都有明确去向。</Headline>
    <div style={{position:'absolute',left:648,top:284,width:630,textAlign:'center',transform:`scale(${anim(f,0,100,.6,1)})`,opacity:anim(f,0,75)}}>
      <div style={{color:C.mute,fontSize:19,letterSpacing:4}}>ORDER PRICE / {order.pricing_snapshot.service_name}</div>
      <div style={{fontSize:120,color:C.white,...numberStyle,marginTop:6}}><AnimatedAmount value={order.total_price} f={f} at={20} duration={128}/></div>
    </div>
    <svg width="1920" height="1080" style={{position:'absolute'}}>
      <FineLine d="M 956 522 C 956 605 580 592 580 667" progress={split} color={C.cyan} width={3}/>
      <FineLine d="M 956 522 C 956 605 1340 592 1340 667" progress={split} color={C.cyan} width={3}/>
      <FineLine d="M 580 821 C 580 922 890 905 960 905" progress={deducted} color={C.blue} width={2} opacity={.7}/>
      <FineLine d="M 1340 821 C 1340 922 1030 905 960 905" progress={deducted} color={C.blue} width={2} opacity={.7}/>
    </svg>
    {[{p:personA,x:320,wage:wageA,tip:tipA},{p:personB,x:1080,wage:wageB,tip:tipB}].map((p,i)=><GlassCard key={p.p.workerId} style={{position:'absolute',left:p.x,top:655,width:520,height:232,padding:'25px 32px',opacity:split,transform:`translateY(${anim(f,180+i*25,145,61,0)}px)`,borderColor:'rgba(100,210,255,.3)'}}>
      <div style={{display:'flex',justifyContent:'space-between',color:C.mute,fontSize:19}}><span>{p.p.workerName} · 订单份额 {p.p.weight}%</span><span>{money(unitShare)}</span></div>
      <div style={{fontSize:22,color:C.cyan,marginTop:14,opacity:deducted}}>抽成 {money(unitShare-p.wage)} / {data.menuItem.club_commission_rate}%</div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'end',marginTop:10}}><span style={{color:C.mute,fontSize:18}}>订单工资</span><AnimatedAmount value={p.wage} f={f} at={510+i*20} duration={145} style={{fontSize:60,color:C.green}}/></div>
      <div style={{position:'absolute',right:31,bottom:-39,padding:'7px 14px',borderRadius:30,color:C.orange,background:'rgba(255,159,10,.13)',fontSize:21,opacity:tips}}>即时打赏 +{money(p.tip)}</div>
    </GlassCard>)}
    <GlassCard style={{position:'absolute',left:810,top:897,width:300,height:117,padding:'20px 24px',textAlign:'center',opacity:deducted}}>
      <div style={{fontSize:18,color:C.mute}}>俱乐部抽成</div><AnimatedAmount value={order.final_club_income} f={f} at={645} duration={115} style={{fontSize:44,color:C.cyan}}/>
    </GlassCard>
  </AbsoluteFill>;
}

function Wage({f}: SceneProps) {
  const intoPeriod=anim(f,132,220);
  const closed=anim(f,555,240);
  const wage=data.settlementRecord?.total_amount ?? order.worker_order_earnings[people[0].workerId];
  return <AbsoluteFill>
    <Backplane frame={f} glow={C.green}/><DemoTag/><Kicker>STEP 06 / WAGE PERIOD</Kicker><Headline>工资进入独立周期。</Headline>
    <PhotoPlane file={closed>.45?'11-payroll-closed.jpg':'10-payroll-active.jpg'} left={76} top={278} width={1110} height={624} imageScale={.578} opacity={.36+intoPeriod*.42} scale={.97+intoPeriod*.03}/>
    <svg width="1920" height="1080" style={{position:'absolute'}}>
      <FineLine d="M 520 714 C 1030 714 1110 500 1305 500" progress={intoPeriod} color={C.green} width={3}/>
      <FineLine d="M 490 754 C 980 825 1100 892 1310 895" progress={anim(f,240,180)} color={C.orange} width={2}/>
    </svg>
    <GlassCard style={{position:'absolute',left:1240,top:352,width:520,height:474,padding:'42px 46px',opacity:intoPeriod,transform:`translateX(${anim(f,132,220,120,0)}px)`,borderColor:closed>.5?'rgba(48,209,88,.38)':undefined}}>
      <div style={{color:C.cyan,fontSize:18,letterSpacing:3}}>WAGE PERIOD / {data.settlementRecord?.worker_name_snapshot ?? people[0].workerName}</div>
      <div style={{fontSize:28,color:C.mute,marginTop:37}}>完成订单 · {data.settlementRecord?.total_orders ?? 1} 单</div>
      <div style={{fontSize:24,color:C.mute,marginTop:23}}>{closed>.5?'本次应发工资':'待结工资'}</div>
      <div style={{fontSize:84,color:C.green,...numberStyle,marginTop:0}}><AnimatedAmount value={wage} f={f} at={290} duration={210}/></div>
      <div style={{fontSize:21,color:C.orange,marginTop:20}}>另有即时打赏 {money(order.worker_tip_earnings[people[0].workerId])}</div>
      <div style={{height:1,background:C.line,margin:'29px 0 23px'}}/>
      <div style={{fontSize:23,color:closed>.5?C.green:C.white}}>{closed>.5?'周期已关闭 · 待发放':'管理员手动结算周期'}</div>
    </GlassCard>
    <div style={{...insetCaption}}>打赏沿独立路径即时归属打手，不进入周期总额。</div>
  </AbsoluteFill>;
}

function Dashboard({f}: SceneProps) {
  const series=data.dashboard.dailyClubIncome;
  const maximum=Math.max(1,...series.map(([,v])=>v));
  const points=series.map(([,v],i)=>`${785+i*(800/Math.max(1,series.length-1))},${690-v/maximum*245}`).join(' ');
  const reveal=anim(f,255,360);
  return <AbsoluteFill>
    <Backplane frame={f}/><DemoTag/><Kicker>STEP 07 / OPERATIONS DATA</Kicker><Headline>每一笔订单，最终成为经营数据。</Headline>
    <PhotoPlane file="12-overview-after.jpg" left={171} top={292} width={1576} height={765} imageScale={.821} opacity={anim(f,0,115,.12,.53)} scale={anim(f,0,110,.94,1)}/>
    <GlassCard style={{position:'absolute',left:178,top:403,width:478,height:357,padding:'34px 38px',opacity:anim(f,80,85)}}>
      <div style={{fontSize:23,color:C.mute}}>本地演示 · 完成订单</div>
      <div style={{fontSize:137,color:C.white,...numberStyle,marginTop:0}}>{Math.round(anim(f,135,145,0,data.dashboard.completedOrders))}</div>
      <div style={{fontSize:24,color:C.cyan,marginTop:5}}>俱乐部抽成 {money(data.dashboard.clubIncome)}</div>
      <div style={{fontSize:20,color:C.orange,marginTop:16}}>即时打赏 {money(data.dashboard.instantTips)}</div>
    </GlassCard>
    <GlassCard style={{position:'absolute',left:735,top:408,width:940,height:403,padding:'33px 35px',opacity:anim(f,205,110)}}>
      <div style={{fontSize:20,color:C.mute,letterSpacing:2}}>DAILY COMMISSION / 源自完成订单</div>
      <svg width="870" height="306" viewBox="0 0 870 306">
        {[60,145,230].map(y=><line key={y} x1="15" y1={y} x2="856" y2={y} stroke="rgba(255,255,255,.09)"/>) }
        <polyline points={points.split(' ').map(p=>{const [x,y]=p.split(',').map(Number);return `${x-770},${y-408}`;}).join(' ')} fill="none" stroke={C.cyan} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1000" strokeDashoffset={1000*(1-reveal)}/>
        {series.map(([day,v],i)=>{
          const x=15+i*(800/Math.max(1,series.length-1)); const y=282-v/maximum*245;
          return <g key={day} opacity={anim(f,330+i*55,90)}><circle cx={x} cy={y} r={6} fill={C.blue}/><text x={x} y={299} fill={C.mute} textAnchor="middle" fontFamily={FONT} fontSize={14}>{day.slice(5)}</text></g>;
        })}
      </svg>
    </GlassCard>
    <div style={{...insetCaption}}>统计来自本地 D1 演示订单；报表依据原始下单时间与完成状态聚合。</div>
  </AbsoluteFill>;
}

const modules=[
  {name:'总览',en:'OVERVIEW',line:'看见经营',image:'12-overview-after.jpg'},
  {name:'接单台',en:'ORDER DESK',line:'建立订单',image:'03-order-desk.jpg'},
  {name:'打手看板',en:'WORKFORCE',line:'连接人员',image:'05-workforce-active.jpg'},
  {name:'价格表',en:'PRICING',line:'定义规则',image:'02-pricing.jpg'},
  {name:'订单与结算',en:'SETTLEMENT',line:'计算结果',image:'09-order-completed.jpg'},
  {name:'工资结算',en:'WAGES',line:'完成闭环',image:'11-payroll-closed.jpg'},
];
function Modules({f}: SceneProps) {
  // A scene is mounted 45 frames early for the crossfade, so its local frame may be negative.
  const index=Math.max(0,Math.min(5,Math.floor(f/100)));const item=modules[index];const within=Math.max(0,f%100);
  const nextOpacity=index===0?1:anim(within,0,25);
  const renderModule=(module: typeof modules[number], i: number, opacity: number) => <AbsoluteFill key={module.name} style={{opacity}}>
    <PhotoPlane file={module.image} left={795} top={151} width={1025} height={730} imageScale={.65} imageX={-136} imageY={-55} opacity={.72} scale={anim(within,0,24,.94,1)}/>
    <div style={{position:'absolute',left:115,top:354,transform:`translateY(${anim(within,0,28,28,0)}px)`}}>
      <div style={{fontSize:27,color:C.cyan,letterSpacing:4}}>{module.en}</div>
      <div style={{fontSize:88,fontWeight:750,color:C.white,marginTop:18}}>{module.name}</div>
      <div style={{fontSize:42,color:C.mute,marginTop:24}}>{module.line}。</div>
    </div>
    <div style={{position:'absolute',left:115,bottom:95,color:C.mute,fontSize:19}}>0{i+1} / 06</div>
  </AbsoluteFill>;
  return <AbsoluteFill>
    <Backplane frame={f}/>
    {index>0?renderModule(modules[index-1],index-1,1-nextOpacity):null}
    {renderModule(item,index,nextOpacity)}
  </AbsoluteFill>;
}

function Closing({f}: SceneProps) {
  const network=anim(f,0,175);
  const collapse=anim(f,235,125);
  const fade=1-anim(f,390,85);
  const orderNodes=[{x:280,y:320},{x:435,y:745},{x:1470,y:268},{x:1645,y:725}];
  return <AbsoluteFill>
    <Backplane frame={f}/>
    <svg width="1920" height="1080" style={{position:'absolute',opacity:fade,transform:`scale(${anim(f,0,220,1.16,1)}) scale(${anim(f,235,125,1,.12)})`,transformOrigin:'960px 510px'}}>
      {orderNodes.map((n,i)=><React.Fragment key={i}>
        <FineLine d={`M ${n.x} ${n.y} Q 960 ${200+i*250} 960 510`} progress={network} color={i%2?C.cyan:C.blue} width={2}/>
        <Dot x={n.x} y={n.y} r={9} color={C.blue} pulse={Math.sin((f+i*24)/30)*.5+.5}/>
      </React.Fragment>)}
      <Dot x={960} y={510} r={22} pulse={Math.sin(f/18)*.5+.5}/>
    </svg>
    <div style={{position:'absolute',left:852,top:400,width:216,height:216,borderRadius:47,background:C.blue,boxShadow:'0 35px 110px rgba(0,122,255,.28)',color:'white',display:'grid',placeItems:'center',fontSize:84,fontWeight:900,letterSpacing:-8,opacity:collapse,transform:`scale(${anim(f,235,125,.15,1)})`}}>DF</div>
    <div style={{position:'absolute',left:0,right:0,top:658,textAlign:'center',opacity:anim(f,285,65)*fade}}>
      <div style={{color:C.white,fontSize:33,letterSpacing:7}}>日晖俱乐部</div>
      <div style={{color:C.white,fontSize:61,fontWeight:760,marginTop:16}}>DELTA FORCE CLUB HUB</div>
      <div style={{color:C.mute,fontSize:26,marginTop:19}}>从订单，到结算。让每一次运营，都有迹可循。</div>
      <div style={{color:C.cyan,fontSize:18,letterSpacing:4,marginTop:39}}>BUILT FOR REAL OPERATIONS.</div>
    </div>
    <div style={{position:'absolute',left:955,top:535,width:11,height:11,borderRadius:99,background:C.blue,opacity:anim(f,420,15,0,1)*(1-anim(f,464,16)),boxShadow:'0 0 28px #007AFF'}}/>
  </AbsoluteFill>;
}

export const Film: React.FC = () => {
  const frame=useCurrentFrame();
  return <AbsoluteFill style={{background:C.bg,color:C.white,fontFamily:FONT,overflow:'hidden'}}>
    {sceneDefs.map(({name,start,end,scene:Scene},i)=>{
      const startFrame=start*FPS,endFrame=end*FPS;
      if(frame<startFrame-45||frame>endFrame+45)return null;
      const entry=anim(frame,startFrame-12,24);
      // The outgoing scene remains fully present until the incoming one covers it.
      // Fading both sides at once had produced near-black frames at scene boundaries.
      const visibility=entry;
      const radius=15+115*entry;
      return <AbsoluteFill key={name} style={{opacity:visibility,clipPath:i===0?undefined:`circle(${radius}% at 50% 52%)`,transform:`scale(${1.055-.055*entry})`}}>
        <Scene f={frame-startFrame} globalFrame={frame}/>
      </AbsoluteFill>;
    })}
    <div style={{position:'absolute',left:0,right:0,bottom:0,height:3,background:`linear-gradient(90deg, ${C.blue} ${(frame/(168*FPS))*100}%, transparent 0)`,opacity:.45}}/>
    <Audio src={staticFile('audio/music.wav')} volume={0.82}/>
    <Audio src={staticFile('audio/sfx.wav')} volume={0.85}/>
  </AbsoluteFill>;
};
