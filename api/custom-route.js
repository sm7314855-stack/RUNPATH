// Public prototype: only Busan coordinates, no caller-selected upstream or profile.
const boundary=require('../data/busan-boundary.json');
const URL='https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson';
const polygons=boundary.coordinates.map(rings=>{const outer=rings[0];let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of outer){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}return {rings,x0,y0,x1,y1}});
function ringContains(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [a,b]=ring[j],[c,d]=ring[i],dx=c-a,dy=d-b;const cross=(p[0]-a)*dy-(p[1]-b)*dx;if((dx!==0||dy!==0)&&Math.abs(cross)<1e-12&&p[0]>=Math.min(a,c)-1e-10&&p[0]<=Math.max(a,c)+1e-10&&p[1]>=Math.min(b,d)-1e-10&&p[1]<=Math.max(b,d)+1e-10)return true;if((b>p[1])!==(d>p[1])&&p[0]<(c-a)*(p[1]-b)/(d-b)+a)inside=!inside}return inside}
function inBusan(p){return polygons.some(({rings,x0,y0,x1,y1})=>p[0]>=x0&&p[0]<=x1&&p[1]>=y0&&p[1]<=y1&&ringContains(p,rings[0])&&!rings.slice(1).some(r=>ringContains(p,r)))}
function valid(p){return Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&inBusan(p)}
function meters(a,b){return Math.hypot((b[0]-a[0])*91000,(b[1]-a[1])*111000)}
function checkRoute(c){let samples=0;for(let i=0;i<c.length;i++){if(!valid(c[i]))return false;if(i){const a=c[i-1],b=c[i],n=Math.ceil(meters(a,b)/25);samples+=n;if(samples>10000)return false;for(let j=1;j<n;j++)if(!inBusan([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]))return false}}return true}
let usage={minute:0,day:0,m:0,d:0};
function reserve(){const now=Date.now(),minute=Math.floor(now/60000),day=Math.floor(now/86400000);if(usage.minute!==minute){usage.minute=minute;usage.m=0}if(usage.day!==day){usage.day=day;usage.d=0}if(usage.m>=20||usage.d>=200)return false;usage.m++;usage.d++;return true}
function err(res,s,error){return res.status(s).json({error})}
module.exports=async function(req,res){res.setHeader('Cache-Control','no-store');let coordinates;
if(req.method==='POST'){if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return err(res,415,'JSON 요청만 지원합니다.');try{const b=typeof req.body==='string'?JSON.parse(req.body):req.body;coordinates=b?.coordinates}catch{return err(res,400,'요청 형식 오류')}}
else if(req.method==='GET'&&req.query?.probe==='inside')coordinates=[[129.09854,35.13802],[129.11813,35.15313]];
else if(req.method==='GET'&&req.query?.probe==='outside')coordinates=[[126.978,37.5665],[129.11813,35.15313]];
else{res.setHeader('Allow','POST');return err(res,405,'경로 요청은 POST를 사용하세요.')}
if(!Array.isArray(coordinates)||coordinates.length!==2||!coordinates.every(valid))return err(res,400,'출발지와 목적지는 부산광역시 행정경계 안에 있어야 합니다.');
if(meters(...coordinates)<20||meters(...coordinates)>45000)return err(res,400,'두 지점은 20m 이상, 직선거리 45km 이내여야 합니다.');
if(!process.env.ORS_API_KEY)return err(res,503,'서버 API 키 설정을 확인하세요.');if(!reserve())return err(res,429,'프로토타입 호출량 제한에 도달했습니다.');
try{const r=await fetch(URL,{method:'POST',headers:{Authorization:process.env.ORS_API_KEY,'Content-Type':'application/json',Accept:'application/geo+json, application/json'},body:JSON.stringify({coordinates,instructions:false}),signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)return err(res,r.status===429?429:502,'경로 서비스 오류 (HTTP '+r.status+')');const data=await r.json(),f=data.features?.[0],c=f?.geometry?.coordinates,s=f?.properties?.summary;if(f?.geometry?.type!=='LineString'||!Array.isArray(c)||c.length<2||c.length>30000||!Number.isFinite(s?.distance)||!Number.isFinite(s?.duration))return err(res,502,'경로 응답 형식 오류');const path=c.map(p=>Array.isArray(p)?p.slice(0,2):null);if(!checkRoute(path))return err(res,422,'계산된 경로가 부산 경계를 벗어나거나 경계 데이터로 검증되지 않습니다. 다른 지점을 선택해 주세요.');return res.status(200).json({coordinates:path,distanceMeters:s.distance,durationSeconds:s.duration,source:'openrouteservice by HeiGIT; OpenStreetMap contributors',profile:'foot-walking'})}catch{return err(res,502,'경로 서비스 연결 실패')}
};