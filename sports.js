// Public fixture data; selected teams are inferred from existing official Home links.
const catalog=[['nba','basketball/nba','nba.com/','knicks','18'],['nhl','hockey/nhl','nhl.com/','rangers','13'],['nfl','football/nfl','giants.com/','','19'],['soccer','soccer/esp.1','realmadrid.com/','','86'],['mlb','baseball/mlb','mlb.com/','',''],['college','football/college-football','apnews.com/','','']];
const localDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
export async function readSports(blocks,now=new Date(),fetcher=fetch){
 const serialized=JSON.stringify(blocks),sources=catalog.filter(([, ,host,team])=>serialized.includes(host)&&(!team||serialized.includes(team)));
 const through=new Date(+now+7*86400000),dates=localDay(now).replaceAll('-','')+'-'+localDay(through).replaceAll('-','');
 if(!sources.length)return {status:'not configured',checkedAt:now.toISOString(),events:[],failures:['No supported official sports links were found on Home.']};
 const events=[],failures=[],seen=new Set();
 const dayList=Array.from({length:8},(_,i)=>{const date=new Date(localDay(now)+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+i);return date.toISOString().slice(0,10).replaceAll('-','');});
 for(const [league,path,,,teamId]of sources){try{
  const daily=[];let cursor=0;
  await Promise.all(Array.from({length:3},async()=>{while(cursor<dayList.length){const day=dayList[cursor++];
    const response=await fetcher('https://site.api.espn.com/apis/site/v2/sports/'+path+'/scoreboard?limit=200&dates='+day,{signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(!Array.isArray(data.events))throw Error('Invalid fixture response');daily.push(...data.events);
  }}));
  for(const e of daily){const c=e.competitions?.[0],teams=c?.competitors||[],start=Date.parse(e.date);if(!Number.isFinite(start)||start<+now||start>+through||e.status?.type?.completed)continue;
   if(teamId&&!teams.some(t=>String(t.team?.id)===teamId))continue;
   if(league==='college'&&!teams.some(t=>t.curatedRank?.current>0&&t.curatedRank.current<=25))continue;
   if(league==='mlb'&&e.season?.type!==3)continue;
   if(seen.has(league+':'+e.id))continue;seen.add(league+':'+e.id);
   events.push({id:league+':'+e.id,title:e.name||teams.map(t=>t.team?.displayName).join(' vs '),start:new Date(start).toISOString(),league,tbd:!!c?.timeValid===false,url:(e.links||[]).find(l=>/^https:\/\/(www\.)?espn\.com\//.test(l.href))?.href||'https://www.espn.com/'});
  }
 }catch{failures.push(league+' schedule could not be checked.');}}
 return {provider:'ESPN',status:failures.length?'partial':'checked',checkedAt:now.toISOString(),events:events.sort((a,b)=>a.start.localeCompare(b.start)),failures};
}
