// Display dimensions in scene units; geometry and material paths share these joins.
// The lift exposes belt supports and open transfer points. It is not a site survey.
export const transferGeometry=Object.freeze({belt:5.2,coal:5.45,lift:2,stackerTip:5.65,reclaimTip:3.65,center:6.9,tripperHead:8.2,tripperOutlet:7.1,unloaderScale:.53,unloaderBoomSlew:.06,unloaderLuff:.025,unloaderBucketSlew:-.32,unloaderOutlet:[5,14,0]});

// Illustrative working pose. The vertical elevator stays plumb as the boom luffs.
export function unloaderGeometry({boomSlew=G.unloaderBoomSlew,luff=G.unloaderLuff,bucketSlew=G.unloaderBucketSlew}={}) {
 const yaw=boomSlew,pitch=luff,bucketYaw=bucketSlew;
 const horizontal=23*Math.cos(pitch)-3*Math.sin(pitch);
 const head=[Math.sin(yaw)*horizontal,17+23*Math.sin(pitch)+3*Math.cos(pitch),Math.cos(yaw)*horizontal];
 const boot=[head[0]+Math.sin(bucketYaw)*5,head[1]-18.2,head[2]+Math.cos(bucketYaw)*5];
 return {head,boot};
}
const G=transferGeometry;
export const beltHeight=asset=>asset.height?asset.height+transferGeometry.lift:transferGeometry.belt;
