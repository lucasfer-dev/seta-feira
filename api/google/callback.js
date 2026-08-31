import { exchangeGoogleCode } from '../../lib/google.mjs';
export default async function handler(req,res){
  try{
    const url=new URL(req.url,'http://localhost');
    const code=url.searchParams.get('code'); const state=url.searchParams.get('state');
    if(!code) throw new Error(url.searchParams.get('error')||'GOOGLE_OAUTH_CODE_MISSING');
    await exchangeGoogleCode(code,state);
    res.statusCode=302;res.setHeader('Location','/?google=connected');res.end();
  }catch(e){
    res.statusCode=302;res.setHeader('Location',`/?google=error&reason=${encodeURIComponent(e.message)}`);res.end();
  }
}
