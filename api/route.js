// Fixed public diagnostic only: no caller-supplied coordinates or upstream URL.
const URL = 'https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson';
const POINTS = [[129.1008,35.1387],[129.1181,35.1532]];
let memo, pending, lastAttempt=0;
const TTL=15*60*1000;
function fail(status,message){const e=new Error(message);e.status=status;return e;}
async function calculate(){
  if(!process.env.ORS_API_KEY)throw fail(503,'ORS_API_KEY가 배포 환경에 설정되지 않았습니다.');
  if(memo&&Date.now()-memo.at<TTL)return memo.data;
  if(pending)return pending;
  if(Date.now()-lastAttempt<30000)throw fail(429,'재시도 간격은 30초입니다.');
  lastAttempt=Date.now();
  pending=(async()=>{
    let response;
    try{response=await fetch(URL,{method:'POST',headers:{Authorization:process.env.ORS_API_KEY,'Content-Type':'application/json',Accept:'application/geo+json, application/json'},body:JSON.stringify({coordinates:POINTS,instructions:false}),signal:AbortSignal.timeout(12000),redirect:'error'});}
    catch(e){throw fail(502,'경로 서비스 연결에 실패했습니다.');}
    if(!response.ok){const s=response.status;throw fail(s===429?429:502,'OpenRouteService 응답 오류 (HTTP '+s+')');}
    const data=await response.json();
    const f=data.features?.[0],s=f?.properties?.summary,c=f?.geometry?.coordinates;
    if(f?.geometry?.type!=='LineString'||!Array.isArray(c)||c.length<2||c.length>30000||!c.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]))||!Number.isFinite(s?.distance)||!Number.isFinite(s?.duration))throw fail(502,'경로 응답 형식이 올바르지 않습니다.');
    const result={source:'openrouteservice by HeiGIT; OpenStreetMap contributors',profile:'foot-walking',coordinates:c.map(p=>p.slice(0,2)),distanceMeters:s.distance,durationSeconds:s.duration,start:POINTS[0],end:POINTS[1],calculatedAt:new Date().toISOString()};
    memo={at:Date.now(),data:result};return result;
  })();
  try{return await pending}finally{pending=null}
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET only'});}
  if(Object.keys(req.query||{}).length)return res.status(400).json({error:'고정 예시 경로 테스트만 지원합니다.'});
  try{const data=await calculate();res.setHeader('Cache-Control','public, s-maxage=900, stale-while-revalidate=60');return res.status(200).json(data)}
  catch(e){return res.status(e.status||502).json({error:e.status?e.message:'경로 응답 처리 실패'});}
};