import { expect, it } from 'vitest';
import sharp from 'sharp';
import { plants, zombies } from '../src/game/content';
import { Engine } from '../src/game/engine';
import { plantSound } from '../src/game/audio';
import { presentationAssets, projectileVisual, projectileHidden, plantAccent, plantBodyPose, zombieVisualPose } from '../src/game/presentation';

it('每种专属弹丸引用现有透明图片，孢子、尖刺、黄油、星星不再退回豌豆',async()=>{
 const expected={puff:'spore',scaredy:'spore',sea:'spore',cactus:'needle',cattail:'homing',kernel:'kernel',butter:'butter',star:'star',melon:'melon',winter:'winter',cabbage:'cabbage'};
 for(const [type,image] of Object.entries(expected)) {
  expect(projectileVisual({type}).image).toBe(image);
  expect((await sharp(`public/assets/presentation/${image}.webp`).metadata()).hasAlpha).toBe(true);
 }
 const bodies=await Promise.all(presentationAssets.map(async id=>{
  const {data,info}=await sharp(`public/assets/presentation/${id}.webp`).raw().toBuffer({resolveWithObject:true});
  expect(info.width).toBe(128);expect(info.height).toBe(128);expect(info.channels).toBe(4);
  expect(data[3]).toBe(0);expect(data.some((v:number,i:number)=>i%4===3&&v>0)).toBe(true);
  return data.toString('base64');
 }));
 expect(new Set(bodies).size).toBe(presentationAssets.length);
});
it('黄油由规则层显式标记，表现层不随机决定伤害或弹种',()=>{
 expect(projectileVisual({type:'kernel',visualType:'butter'}).image).toBe('butter');
 expect(projectileVisual({type:'kernel'}).image).toBe('kernel');
 expect(projectileHidden({hit:false,delay:.16})).toBe(true);
 expect(projectileHidden({hit:false,delay:0})).toBe(false);
 expect(projectileHidden({hit:true})).toBe(true);
});
it('所有植物和僵尸表现读取不改变实体，受伤休眠有不同表现',()=>{
 const e=new Engine(11,[]);
 for(const def of plants){
  const p=e.addPlant(def.id,0,0);p.age=2;p.attackAge=.1;
  const before=JSON.stringify(p);
  expect(Object.values(plantBodyPose(p)).every(Number.isFinite)).toBe(true);
  plantAccent(p);expect(JSON.stringify(p)).toBe(before);
  p.sleep=true;expect(plantAccent(p)?.image).toBe('sleep');
 }
 const wall=e.addPlant('wallnut',0,1);wall.hp=100;
 expect(plantAccent(wall)?.image).toBe('crack');
 for(const def of zombies){e.spawn(def.id,0,5);const z=e.zombies.at(-1)!;const before=JSON.stringify(z);expect(Object.values(zombieVisualPose(z)).every(Number.isFinite)).toBe(true);expect(JSON.stringify(z)).toBe(before);}
});
it('发射音色区分孢子、尖刺、星星、投掷物与冰弹',()=>{
 expect(plantSound('puff')).toBe('spore');expect(plantSound('cactus')).toBe('needle');
 expect(plantSound('star')).toBe('star');expect(plantSound('butter')).toBe('butter');
 expect(plantSound('melon')).toBe('lob');expect(plantSound('winter')).toBe('frost');
});

it('前后出膛位置与闪光一致，每颗只产生一次对应发射声',()=>{
 const e=new Engine(1,[]);const p=e.addPlant('split',0,4);
 e.spawn('basic',0,7);e.spawn('basic',0,1);e.drainSounds();
 e.shoot(p,e.zombies[0],20);e.shoot(p,e.zombies[1],20);
 expect(e.shots.map(s=>[s.x,s.originX,s.direction])).toEqual([[4.35,4.35,1],[3.65,3.65,-1]]);
 expect(e.effects.filter(f=>f.type==='shoot').map(f=>f.x+f.direction!*.35)).toEqual(e.shots.map(s=>s.x));
 expect(e.drainSounds().map(s=>s.kind)).toEqual(['pea','pea']);
});
it('金币与阳光收集发不同音效，资源数值不变',()=>{
 const e=new Engine(1,[]),sun=e.sun;
 e.token(1,0,10,true);e.token(1,0,25);e.drainSounds();
 for(const t of [...e.tokens])e.collect(t.uid);
 expect(e.coins).toBe(10);expect(e.sun).toBe(sun+25);
 expect(e.drainSounds().map(s=>s.kind)).toEqual(['coin','sun']);
});
it('磁力、吹风、海草的成功事件接入专属图片和声音',()=>{
 for(const [id,level,enemy,fx] of [['magnet',11,'bucket','magnet'],['blover',11,'balloon','wind'],['kelp',21,'ducky','splash']] as const){
  const e=new Engine(level,[]);e.tiles=[];const row=id==='kelp'?2:0;
  const p=e.addPlant(id,row,3);p.timer=0;p.age=2;e.spawn(enemy,row,3.5);e.drainSounds();e.step(.01);
  expect(e.effects.some(f=>f.type===fx&&f.source===id)).toBe(true);
  const kinds=e.drainSounds().map(s=>s.kind);expect(kinds).toContain(fx);expect(kinds).not.toContain('freeze');
 }
});
it('显式黄油弹使用黄油发射声，普通玉米粒仍为投掷声',()=>{
 const e=new Engine(1,[]);const p=e.addPlant('kernel',0,2);e.spawn('basic',0,5);e.drainSounds();
 e.shoot(p,e.zombies[0],40,'butter');e.shoot(p,e.zombies[0],20,'kernel');
 expect(e.drainSounds().map(s=>s.kind)).toEqual(['butter','lob']);
 expect(e.effects.filter(f=>f.type==='shoot').map(f=>f.source)).toEqual(['butter','kernel']);
});
