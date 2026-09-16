/** Presentation-only adapters. Nothing here changes combat state or random numbers. */
import type { Plant, Shot, Zombie } from './engine';
export const presentationAssets = ['pea','icepea','spore','needle','homing','cabbage','kernel','butter','melon','winter','star','fire','cob','basketball','snowball','sun','coin','shield','magnet','crack','iceblock','sleep','splash','dust','impact','bloom','wind','ring'] as const;
export type Illustration = typeof presentationAssets[number];
export const presentationImage = (id: Illustration) => `${import.meta.env.BASE_URL}assets/presentation/${id}.webp`;
export type ProjectileVisual = { image: Illustration; width: number; height: number; trail: number; lob: boolean; spin: boolean };
const projectiles: Record<string, Partial<ProjectileVisual> & { image: Illustration }> = {
 pea:{image:'pea'}, repeater:{image:'pea'}, three:{image:'pea'}, split:{image:'pea'}, gatling:{image:'pea'},
 snowpea:{image:'icepea',trail:0xb5edfc}, icepea:{image:'icepea',trail:0xb5edfc},
 puff:{image:'spore',width:30,height:25,trail:0xc29bde}, scaredy:{image:'spore',width:30,height:25,trail:0xc29bde}, sea:{image:'spore',width:27,height:23,trail:0xc29bde}, spore:{image:'spore',trail:0xc29bde},
 cactus:{image:'needle',width:34,height:20,trail:0xb8d385}, needle:{image:'needle',width:34,height:20},
 cattail:{image:'homing',width:34,height:22,trail:0xa4d7d0}, homing:{image:'homing',width:34,height:22},
 cabbage:{image:'cabbage',width:34,height:34,lob:true,spin:true},
 kernel:{image:'kernel',width:25,height:25,lob:true,spin:true}, butter:{image:'butter',width:32,height:32,lob:true,spin:true,trail:0xffdf83},
 melon:{image:'melon',width:43,height:40,lob:true,spin:true}, winter:{image:'winter',width:43,height:40,lob:true,spin:true,trail:0xb5edfc},
 star:{image:'star',width:30,height:30,spin:true,trail:0xffe89b}, fire:{image:'fire',width:46,height:33,trail:0xffaf59},
 cob:{image:'cob',width:56,height:40,lob:true,trail:0xf7d584}, basketball:{image:'basketball',width:34,height:34,lob:true,spin:true}, snowball:{image:'snowball',width:54,height:54,spin:true,trail:0xb5edfc},
};
/** Optional visualType lets the rules layer identify butter before launch. */
export function projectileVisual(shot: Pick<Shot,'type'> & {visualType?: string}): ProjectileVisual {
 return {width:25,height:25,trail:0xb5d48b,lob:false,spin:false,...(projectiles[shot.visualType ?? shot.type] ?? {image:'pea'})};
}
export function projectileHidden(shot: {delay?:number; hit:boolean}) { return shot.hit || (shot.delay ?? 0) > 0; }
export type PlantAccent = { image: Illustration; alpha: number; scale: number; angle: number; offsetY: number };
export function plantAccent(p: Plant): PlantAccent | null {
 const pulse = (Math.sin(p.age * 3 + p.uid) + 1) / 2;
 const accent = (image: Illustration, alpha=.7, scale=1, offsetY=-45): PlantAccent => ({image,alpha,scale,angle:0,offsetY});
 if (p.sleep) return {...accent('sleep',.65 + pulse*.25,.48,-67),offsetY:-67-pulse*5};
 if (['wallnut','tallnut','pumpkin','pot'].includes(p.id) && p.hp < p.max*.66) return accent('crack',.85,p.hp < p.max*.33?.9:.65,-34);
 if (p.id==='potato') return accent(p.ready?'impact':'dust',p.ready?.55+pulse*.4:.4,p.ready?.23:.32,-42);
 if (p.id==='lantern') return accent('sun',.25+pulse*.15,1.15,-36);
 if (p.id==='torch') return {...accent('fire',.9,.65,-56),angle:-90,scale:.6+pulse*.12};
 if (p.id==='magnet'||p.id==='goldmagnet') return {...accent('ring',.18+pulse*.22,.8,-38),angle:p.age*30};
 if (p.id==='umbrella') return accent('shield',.13+pulse*.13,1.1,-39);
 if (p.id==='hypno') return {...accent('ring',.25+pulse*.25,.65,-44),angle:p.age*45};
 if (p.id==='ice') return accent('iceblock',.55+pulse*.25,.95,-40);
 if (p.id==='blover') return {...accent('wind',.7,1,-36),angle:Math.sin(p.age*8)*12};
 if (p.id==='coffee') return accent('spore',.35,.5,-65-pulse*8);
 if (p.id==='grave') return accent('dust',.6,.8,-15);
 if (p.id==='cob' && p.ready) return {...accent('ring',.8,.95,-35),angle:p.age*24};
 if (p.id==='imitater') return accent('spore',.25+pulse*.15,.9,-40);
 if (['sunflower','sunshroom','twin','marigold'].includes(p.id) && !p.sleep && p.timer < 1.5)
   return accent(p.id==='marigold'?'coin':'sun',.35+pulse*.3,.55,-66);
 return null;
}
/** Root-anchored whole-body motion for plants without articulated heads. */
export function plantBodyPose(p: Plant) {
 if(p.sleep) return {scaleX:1,scaleY:1,angle:0};
 const a=Math.sin(p.age*3+p.uid), attack=Math.max(0,1-(p.attackAge??1)/.35);
 const growth=Math.min(1,p.age/.25);
 let scaleX=1,scaleY=.88+.12*growth,angle=0;
 if(['lily','kelp','sea'].includes(p.id)) {scaleX+=a*.018;angle=a*2;}
 if(['cherry','doom','jalapeno'].includes(p.id)) {scaleX+=Math.sin(p.age*24)*.035;scaleY+=Math.abs(Math.sin(p.age*18))*.06;}
 if(p.id==='squash') {scaleX+=a*.02+attack*.12;scaleY-=a*.02+attack*.12;}
 if(p.id==='blover') {angle=Math.sin(p.age*9)*9;scaleX+=a*.035;}
 if(p.id==='garlic') angle=a*1.4;
 if(['spike','spikerock'].includes(p.id)) scaleY+=attack*.08;
 if(['magnet','goldmagnet','hypno'].includes(p.id)) angle=a*2;
 if(p.id==='cob') angle=-attack*5;
 return {scaleX,scaleY,angle};
}
export function zombieAccent(z: Zombie): Illustration | null {
 if(z.freeze>0) return 'iceblock';
 if(z.underground) return 'dust';
 if(z.disarmed) return 'magnet';
 if(z.ally) return 'bloom';
 if(['ducky','snorkel','dolphin'].includes(z.id)) return 'splash';
 if(z.id==='jack') return 'star';
 if(['zomboni','catapult','bobsled'].includes(z.id)) return 'dust';
 if(z.id==='dancer'&&z.special) return 'ring';
 return null;
}

/** Extra offsets only in the renderer: never change grid position or hit timing. */
export function zombieVisualPose(z: Zombie) {
 const clock = z.actionTime ?? z.age;
 const beat = Math.sin(clock*8);
 if(z.id==='bungee') return {angle:Math.sin(z.age*2)*4, offsetY:-Math.max(0,1-z.age/1.2)*200};
 if(z.id==='jack'&&!z.disarmed) return {angle:beat*2.5,offsetY:0};
 if(z.id==='catapult'&&z.action==='special') return {angle:Math.sin(clock*2)*1.5,offsetY:Math.max(0,1-z.timer/.2)*-3};
 if(z.id==='paper'&&z.armor===0) return {angle:-3,offsetY:0};
 if(z.id==='snorkel') return {angle:0,offsetY:z.action==='eat'?0:20};
 if(z.id==='ladder'&&!z.jumped) return {angle:Math.sin(z.motion*.15)*1.5,offsetY:0};
 return {angle:0,offsetY:0};
}
