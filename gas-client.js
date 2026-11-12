/**
 * Cliente HTTP do Apps Script. O POST usa modo no-cors para evitar preflight;
 * o resultado é consultado por JSONP usando um requestId aleatório.
 */
const ENDPOINT = window.DG_GAS_URL || "COLE_AQUI_URL_DO_APPS_SCRIPT";

function requestId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
}

function pollResult(id, timeoutMs=25000) {
  return new Promise((resolve,reject) => {
    const started=Date.now();
    const callback="dgGasCb_"+id;
    let finished=false;
    const cleanup=()=>{
      finished=true;
      try { delete window[callback]; } catch(e) { window[callback]=undefined; }
    };
    const poll=()=>{
      if(finished) return;
      if(Date.now()-started>timeoutMs) {
        cleanup();
        reject(new Error("O servidor demorou para responder. Tente novamente."));
        return;
      }
      const script=document.createElement("script");
      const separator=ENDPOINT.includes("?")?"&":"?";
      script.src=ENDPOINT+separator+"action=result&requestId="+id+"&callback="+callback+"&t="+Date.now();
      script.onerror=()=>{
        script.remove();
        setTimeout(poll,700);
      };
      script.onload=()=>script.remove();
      window[callback]=(result)=>{
        script.remove();
        if(result && result.pending) setTimeout(poll,500);
        else {
          cleanup();
          if(!result || result.ok!==true) reject(new Error(result && result.error || "Não foi possível concluir a operação."));
          else resolve(result);
        }
      };
      document.head.appendChild(script);
    };
    poll();
  });
}

export async function gasRequest(action, data={}, idToken="") {
  if(!ENDPOINT || !/\/exec(?:\?.*)?$/.test(ENDPOINT)) {
    throw new Error("O endereço do Apps Script ainda não foi configurado.");
  }
  const id=requestId();
  const payload={requestId:id,action,data:{...data}};
  if(idToken) payload.data.idToken=idToken;
  // text/plain é uma requisição simples; a resposta é recuperada pelo JSONP acima.
  fetch(ENDPOINT,{method:"POST",mode:"no-cors",redirect:"follow",body:JSON.stringify(payload)})
    .catch(err=>console.warn("Envio ao Apps Script:",err));
  return pollResult(id);
}
