/* =========================================================
   AudioFeel — dependency-free spectral "feel" analysis
   FFT-based brightness/percussiveness/noisiness/bass curves,
   binned onto the same 0.25s timebase computeEnvelope() in
   index.html uses for its energy envelope, so callers can
   sample all curves by the same bin index. No DOM, no app
   state — pure math, exposed as window.AudioFeel.
   ========================================================= */
'use strict';
window.AudioFeel = (function(){
  const W = 2048, H = 1024; // ~46ms window @44.1kHz, 50% overlap — enough resolution to isolate the <150Hz bass band without costing more than ~1-2s on a full track
  const HANN = new Float32Array(W);
  for(let i=0;i<W;i++)HANN[i]=0.5*(1-Math.cos(2*Math.PI*i/(W-1)));
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

  /* Iterative in-place radix-2 Cooley-Tukey FFT (power-of-2 length only). */
  function fft(re,im){
    const n=re.length;
    for(let i=1,j=0;i<n;i++){
      let bit=n>>1;
      for(;j&bit;bit>>=1)j^=bit;
      j^=bit;
      if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}
    }
    for(let len=2;len<=n;len<<=1){
      const ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang), half=len>>1;
      for(let i=0;i<n;i+=len){
        let cwr=1,cwi=0;
        for(let j=0;j<half;j++){
          const ur=re[i+j],ui=im[i+j];
          const tr=re[i+j+half]*cwr-im[i+j+half]*cwi;
          const ti=re[i+j+half]*cwi+im[i+j+half]*cwr;
          re[i+j]=ur+tr;im[i+j]=ui+ti;
          re[i+j+half]=ur-tr;im[i+j+half]=ui-ti;
          const ncwr=cwr*wr-cwi*wi, ncwi=cwr*wi+cwi*wr;
          cwr=ncwr;cwi=ncwi;
        }
      }
    }
  }

  function movingAverage(arr,radius){
    const n=arr.length,out=new Float32Array(n);
    for(let i=0;i<n;i++){
      const lo=Math.max(0,i-radius),hi=Math.min(n,i+radius+1);
      let s=0;for(let k=lo;k<hi;k++)s+=arr[k];
      out[i]=s/(hi-lo);
    }
    return out;
  }
  /* Percentile normalize (5th->0, 95th->1, clamped) — same scheme
     computeEnvelope() uses, so feel curves and the energy envelope read on
     comparable scales regardless of a track's absolute loudness/mastering. */
  function percentileNormalize(arr){
    const n=arr.length;
    const sorted=Float32Array.from(arr).sort();
    const p5=sorted[Math.max(0,Math.floor(n*0.05))]||0;
    const p95=sorted[Math.min(n-1,Math.floor(n*0.95))]||1;
    const range=Math.max(1e-9,p95-p5);
    const out=new Float32Array(n);
    for(let i=0;i<n;i++)out[i]=clamp((arr[i]-p5)/range,0,1);
    return out;
  }

  /* One-shot offline pass over a decoded mono buffer. Resolves null (never
     rejects) on abort or any internal failure — callers treat null as "no
     feel data available" and fall back to loudness-only analysis. */
  async function analyze(mono,sr,opts){
    opts=opts||{};
    const shouldAbort=opts.shouldAbort||(()=>false);
    const yieldEvery=opts.yieldEvery||400;
    try{
      const n=mono.length;
      const hopSec=0.25;
      const hopSamples=Math.max(1,Math.round(sr*hopSec));
      const nBins=Math.max(1,Math.ceil(n/hopSamples));
      const nFrames=Math.max(1,Math.ceil(n/H));
      const halfW=W/2;

      const sumBright=new Float64Array(nBins), sumFlat=new Float64Array(nBins);
      const sumFlux=new Float64Array(nBins), sumBass=new Float64Array(nBins);
      const binCount=new Int32Array(nBins);

      const re=new Float32Array(W), im=new Float32Array(W);
      const magPrev=new Float32Array(halfW);
      let havePrev=false;

      for(let k=0;k<nFrames;k++){
        const start=k*H;
        for(let i=0;i<W;i++){
          const s=start+i;
          re[i]=(s<n?mono[s]:0)*HANN[i];
          im[i]=0;
        }
        fft(re,im);

        let sumMagF=0,sumMag=0,sumLnP=0,sumP=0,sumBassP=0,flux=0;
        for(let b=1;b<halfW;b++){
          const mag=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
          const p=mag*mag;
          const fk=b*sr/W;
          sumMagF+=fk*mag;sumMag+=mag;
          sumLnP+=Math.log(p+1e-12);sumP+=p;
          if(fk<150)sumBassP+=p;
          if(havePrev){const d=mag-magPrev[b];if(d>0)flux+=d;}
          magPrev[b]=mag;
        }
        havePrev=true;

        const countBins=halfW-1;
        const centroidHz=sumMag>1e-9?sumMagF/sumMag:0;
        const flatness=Math.exp(sumLnP/countBins)/(sumP/countBins+1e-12);
        const bassRatio=sumBassP/(sumP+1e-12);

        /* Bin index i means "time i*hopSec" throughout index.html
           (computeEnvelope's center=h*hop, segmentTrack's idx0*hopSec) — round
           each frame's center time onto the nearest such index so this curve
           lines up 1:1 with the energy envelope's own hop indexing. */
        const centerSec=(start+W/2)/sr;
        const bin=clamp(Math.round(centerSec/hopSec),0,nBins-1);
        sumBright[bin]+=centroidHz;sumFlat[bin]+=flatness;
        sumFlux[bin]+=flux;sumBass[bin]+=bassRatio;
        binCount[bin]++;

        if((k+1)%yieldEvery===0){
          await new Promise(r=>setTimeout(r,0));
          if(shouldAbort())return null;
        }
      }

      const brightRaw=new Float32Array(nBins), flatRaw=new Float32Array(nBins);
      const fluxRaw=new Float32Array(nBins), bassRawArr=new Float32Array(nBins);
      for(let i=0;i<nBins;i++){
        const c=binCount[i]||1;
        brightRaw[i]=sumBright[i]/c;flatRaw[i]=sumFlat[i]/c;
        fluxRaw[i]=sumFlux[i]/c;bassRawArr[i]=sumBass[i]/c;
      }

      /* Brightness/noisiness/bass are meant to read as structural qualities
         of a section, so they get the same ±2s smoothing as the energy
         envelope; percussiveness stays twitchy (±0.5s) so it can still
         drive per-cut flash/glitch odds. */
      const smoothWide=Math.max(1,Math.round(2/hopSec));
      const smoothTight=Math.max(1,Math.round(0.5/hopSec));

      return{
        hopSec,n:nBins,
        brightness:percentileNormalize(movingAverage(brightRaw,smoothWide)),
        percussive:percentileNormalize(movingAverage(fluxRaw,smoothTight)),
        noisiness:percentileNormalize(movingAverage(flatRaw,smoothWide)),
        bass:percentileNormalize(movingAverage(bassRawArr,smoothWide))
      };
    }catch(e){
      return null;
    }
  }

  return{analyze};
})();
