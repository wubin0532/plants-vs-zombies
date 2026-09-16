async (page) => {
const taskDownload = page.waitForEvent('download', {timeout:120000});
const result = await page.evaluate(async () => {
 const {GardenAudio}=await import('/src/game/audio.ts');
 const {audioCatalog}=await import('/src/game/audio-catalog.ts');
 const files=[],metrics=[];const encoder=new TextEncoder();
 for(const sample of audioCatalog){
  const length=sample.kind==='music'?4:2.5,rate=22050;
  const ctx=new OfflineAudioContext(1,Math.ceil(rate*length),rate);
  const a=new GardenAudio();
  a.ctx=new Proxy(ctx,{get(t,k){if(k==='state')return 'running';const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
  a.master=ctx.createGain();a.master.gain.value=.65;
  const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-16;compressor.ratio.value=6;
  a.master.connect(compressor);compressor.connect(ctx.destination);
  a.noise=ctx.createBuffer(1,rate*2,rate);let seed=7121;const noise=a.noise.getChannelData(0);
  for(let i=0;i<noise.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise[i]=seed/2147483648-1;}
  a.scene=sample.scene??'day';a.musicBeat=0;
  a.play(sample.kind,4,sample.source);
  const buffer=await ctx.startRendering(), raw=buffer.getChannelData(0);
  let last=raw.length-1;while(last>0&&Math.abs(raw[last])<1/32767)last--;
  const data=raw.subarray(0,Math.min(raw.length,last+1+Math.ceil(rate*.08)));
  let peak=0,energy=0;for(const v of data){peak=Math.max(peak,Math.abs(v));energy+=v*v;}
  const bytes=new Uint8Array(44+data.length*2),view=new DataView(bytes.buffer);
  const str=(offset,s)=>{for(let i=0;i<s.length;i++)bytes[offset+i]=s.charCodeAt(i);};
  str(0,'RIFF');view.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,data.length*2,true);
  data.forEach((v,i)=>view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,v))*32767),true));
  files.push({name:sample.id+'.wav',bytes});metrics.push({...sample,peak,rms:Math.sqrt(energy/data.length),seconds:data.length/rate});
 }
 files.push({name:'manifest.json',bytes:encoder.encode(JSON.stringify({version:1,format:'PCM mono 22050Hz 16bit',note:'Offline exports of GardenAudio; music files are timbre samples, live soundtrack is sequenced in game.',samples:metrics},null,2))});
 // Uncompressed ZIP, so the export is reproducible and needs no external service.
 const chunks=[],central=[];let offset=0;
 const crc32=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 for(const f of files){const name=encoder.encode(f.name),crc=crc32(f.bytes),h=new Uint8Array(30+name.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,f.bytes.length,true);v.setUint32(22,f.bytes.length,true);v.setUint16(26,name.length,true);h.set(name,30);chunks.push(h,f.bytes);const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc,true);cv.setUint32(20,f.bytes.length,true);cv.setUint32(24,f.bytes.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);central.push(c);offset+=h.length+f.bytes.length;}
 const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,central.reduce((n,c)=>n+c.length,0),true);ev.setUint32(16,offset,true);
 const url=URL.createObjectURL(new Blob([...chunks,...central,end],{type:'application/zip'}));const link=document.createElement('a');link.href=url;link.download='pvz-audio.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 return {count:metrics.length,silent:metrics.filter(s=>s.rms<.00001).map(s=>s.id),clipped:metrics.filter(s=>s.peak>=1).map(s=>s.id),peak:Math.max(...metrics.map(s=>s.peak))};
});
const download=await taskDownload;await download.saveAs('output/pvz-audio.zip');console.log(result);

}
