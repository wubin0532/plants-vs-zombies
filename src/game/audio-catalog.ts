import { plants, zombies } from './content';
import { plantSound, type SoundKind } from './audio';
export type AudioSample = {id:string;label:string;kind:SoundKind;source?:string;scene?:string};
/** Stable IDs for preview, exported WAVs and integration. */
export const audioCatalog: AudioSample[] = [
 ...plants.map(p=>({id:'plant-'+p.id,label:p.name,kind:plantSound(p.id),source:p.id})),
 ...zombies.map(z=>({id:'zombie-'+z.id,label:z.name,kind:'groan' as const,source:z.id})),
 ...(['butter','smash','chomp','land','step','break','plant','sun','coin','win','lose','click','bite','death','hit','metal','explosion','freeze','mower','jump','shovel','warning','horn','danger','splash'] as SoundKind[]).map(kind=>({id:'event-'+kind,label:kind,kind})),
 ...['day','night','pool','fog','roof'].flatMap(scene=>(['music','ambient'] as const).map(kind=>({id:kind+'-'+scene,label:scene+' '+kind,kind,scene}))),
];
