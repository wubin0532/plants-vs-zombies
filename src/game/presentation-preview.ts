/** Local review entry point; deliberately separate from the player's App and saves. */
import { plants, zombies, plantById, zombieById } from './content';
import { plantImage, zombieImage } from './art';
import { GardenAudio, plantSound, type SoundKind } from './audio';
import { Engine } from './engine';
import { mountGame } from './scene';
import { presentationAssets, presentationImage, type Illustration } from './presentation';
const $ = (id:string) => document.getElementById(id)!;
const audio = new GardenAudio(); audio.enabled=false;
let game: Awaited<ReturnType<typeof mountGame>> | undefined;
let engine: Engine; let generation=0; let selected={kind:'plant',id:'puff'};
let frozen=false; let fogOn=false;
const captions:Record<string,string>={pea:'豌豆',icepea:'冰豌豆',spore:'孢子',needle:'仙人掌刺',homing:'追踪尖刺',cabbage:'卷心菜',kernel:'玉米粒',butter:'黄油',melon:'西瓜',winter:'冰西瓜',star:'星星',fire:'火球',cob:'炮弹',basketball:'篮球',snowball:'冰球',sun:'阳光',coin:'金币',shield:'保护伞护盾',magnet:'磁力',crack:'破损',iceblock:'冻结',sleep:'休眠',splash:'水花',dust:'尘土',impact:'冲击',bloom:'魅惑',wind:'风',ring:'能量环'};
function card(parent:string,id:string,title:string,image:string,kind:string) {
 const button=document.createElement('button');button.className='card'+(kind==='asset'?' asset':'');
 const img=document.createElement('img');img.src=image;img.alt='';
 const label=document.createElement('span');label.textContent=title;
 button.append(img,label);button.onclick=()=>{selected={kind,id};void show();};$(parent).append(button);
}
for(const p of plants) card('plants',p.id,p.name,plantImage(p.id),'plant');
for(const z of zombies) card('zombies',z.id,z.name,zombieImage(z.id),'zombie');
for(const id of presentationAssets) card('assets',id,captions[id]??id,presentationImage(id),'asset');
const sounds: [SoundKind,string,string?][] = [
 ['pea','豌豆','pea'],['pea','双发','repeater'],['pea','机枪','gatling'],['spore','小喷菇','puff'],['spore','大喷菇','fume'],['spore','海蘑菇','sea'],['spore','忧郁菇','gloom'],['needle','仙人掌','cactus'],['needle','香蒲','cattail'],['star','杨桃'],['lob','卷心菜','cabbage'],['lob','玉米','kernel'],['butter','黄油'],['lob','西瓜','melon'],['frost','冰弹'],['magnet','磁力'],['wind','三叶草'],['splash','水花'],['chomp','吞噬'],['smash','巨人重击'],['explosion','樱桃','cherry'],['explosion','辣椒','jalapeno'],['explosion','毁灭菇','doom'],['explosion','土豆地雷','potato'],['explosion','玉米炮','cob'],['groan','普通僵尸','basic'],['groan','巨人','garg'],['groan','小鬼','imp'],['groan','玩偶匣','jack'],['metal','金属护甲','bucket'],['metal','路障','cone'],['bite','啃咬'],['death','死亡'],['jump','跳跃'],['land','落地'],['mower','割草机'],['sun','收阳光'],['coin','收金币'],['plant','种植'],['shovel','铲除'],['freeze','冻结'],['warning','警告'],['horn','大波进攻'],['win','胜利'],['lose','失败']
];
for(const [kind,label,source] of sounds){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{audio.stop();audio.enabled=true;$('mute').textContent='声音：开';await audio.unlock();audio.play(kind,4,source);};$('sounds').append(b);}
function seedDemo(e:Engine) {
 e.plants=[];e.zombies=[];e.shots=[];e.effects=[];e.tiles=[];
 const water=['sea','kelp','lily','cattail'].includes(selected.id);
 const row=water?2:Math.floor(e.level.rows/2);
 if(selected.kind==='plant') {
   const p=e.addPlant(selected.id,row,3);p.sleep=false;p.timer=.7;
   if(selected.id==='potato') {p.age=15;p.ready=true;}
   if(selected.id==='cob') {p.timer=0;p.ready=true;}
   e.spawn(water?'ducky':'basic',row,5.6);
   if(selected.id==='split') e.spawn('basic',row,1.3);
   if(selected.id==='three'||selected.id==='star') for(const r of [row-1,row+1]) if(r>=0&&r<e.level.rows)e.spawn('basic',r,7);
 } else if(selected.kind==='zombie') {
   if(selected.id==='boss') {e.level.mode='boss';e.bossDown=10;}
   else {e.level.mode='normal';e.spawn(selected.id,row,5.5);}
   e.addPlant('wallnut',row,3);
 } else {
   const p=e.addPlant('pea',row,1);p.timer=Infinity;e.spawn('bucket',row,8);
   const shotType = selected.id==='icepea'?'snowpea':selected.id==='needle'?'cactus':selected.id==='homing'?'cattail':selected.id==='spore'?'puff':selected.id;
   if(['sun','coin','shield','magnet','crack','iceblock','sleep','splash','dust','impact','bloom','wind','ring'].includes(selected.id)) {
     // These are static illustrations below; use associated states in the live stage.
     const plantMap:Partial<Record<Illustration,string>>={shield:'umbrella',magnet:'magnet',crack:'wallnut',sleep:'puff',wind:'blover',ring:'hypno',sun:'sunflower',coin:'marigold'};
     const unit=e.addPlant(plantMap[selected.id as Illustration]??'ice',row,4);
     if(selected.id==='sleep') unit.sleep=true;
     if(selected.id==='crack') unit.hp=unit.max*.3;
   } else {
     e.shoot(p,e.zombies[0],0,shotType);
   }
 }
}
async function show(){
 const gen=++generation;game?.destroy(true);audio.stop();frozen=false;
 let level=Number(($('scene') as HTMLSelectElement).value);
 if(['sea','kelp','lily','cattail'].includes(selected.id)&&![21,31].includes(level))level=31;
 engine=new Engine(level,[]);engine.schedule=[];engine.sun=9999;engine.eventAt=-1;engine.fogClear=fogOn?0:9999;
 if(fogOn&&engine.level.scene==='fog')engine.time=30;
 seedDemo(engine);
 const addFogDemo=()=>{if(fogOn&&engine.level.scene==='fog')engine.addPlant('lantern',1,6);};
 addFogDemo();
 $('caption').textContent=selected.kind==='plant'?`${plantById[selected.id].name} · ${plantById[selected.id].desc}`:selected.kind==='zombie'?`${zombieById[selected.id].name} · 行走、受击与特殊动作`:`${captions[selected.id]??selected.id} · 透明背景原创图片`;
 let resetAt=engine.time;
 const mounted=await mountGame($('stage'),engine,()=>{
  if(gen!==generation)return;
  if(engine.time-resetAt>7){seedDemo(engine);addFogDemo();resetAt=engine.time;}
 },{audio,quality:()=> 'high',shake:()=>false});
 if(gen!==generation)mounted.destroy(true);else game=mounted;
}
$('scene').onchange=()=>void show();$('reset').onclick=()=>void show();
$('fog').onclick=()=>{fogOn=!fogOn;$('fog').textContent=fogOn?'迷雾：开':'迷雾：关';void show();};
$('pause').onclick=()=>{engine.paused=!engine.paused;$('pause').textContent=engine.paused?'继续动画':'暂停动画';};
$('mute').onclick=async()=>{audio.enabled=!audio.enabled;$('mute').textContent=audio.enabled?'声音：开':'声音：关';if(audio.enabled)await audio.unlock();};
$('hurt').onclick=()=>{for(const p of engine.plants){p.hp=p.max*.3;p.hurt=.16;}for(const z of engine.zombies){z.hp=z.max*.4;z.armor=0;z.hurt=.16;}};
$('freeze').onclick=()=>{frozen=!frozen;for(const z of engine.zombies)z.freeze=frozen?5:0;for(const p of engine.plants)p.sleep=frozen;};
$('special').onclick=()=>{
 for(const z of engine.zombies){
  if(z.id==='garg'||z.id==='dancer'){z.special={kind:z.id==='garg'?'throw':'summon',elapsed:0,duration:.9,hit:false};z.action='special';}
  else if(['pole','pogo','dolphin','ladder'].includes(z.id)){z.jump={from:z.x,to:z.x-1.25,elapsed:0,duration:.85,kind:'vault'};z.action='jump';}
  else {z.ally=!z.ally;z.reverse=z.ally;}
 }
 for(const p of engine.plants){p.attackAge=0;p.timer=0;if(p.id==='chomper')p.chomp={target:engine.zombies[0]?.uid??0,elapsed:0,hit:false};audio.play(plantSound(p.id),p.col,p.id);}
};
window.addEventListener('pagehide',()=>{game?.destroy(true);audio.dispose();});
void show();
