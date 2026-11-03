'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { canAnimateMascot } from './mascot-anim';
import styles from './LandingView.module.css';

const VIDEO_SRC = '/brand/mascot.webm';

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

/**
 * Escorpião da landing: o poster (quadro 0 da animação, 2x) é sempre renderizado e é
 * o LCP; onde o navegador toca WebM com alpha (não Safari/iPhone — ver mascot-anim.ts)
 * o vídeo carrega depois do `load`, entra por cima com fade e pausa fora da tela.
 * É decorativo: sem PiP/"pop-out" (Opera, Edge) nem transmissão.
 */
export function HeroMascot() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const connection = (navigator as Navigator & { connection?: NetworkInfo }).connection;
    const animate = canAnimateMascot({
      canPlayWebmVp9: video.canPlayType('video/webm; codecs="vp9"') !== '',
      vendor: navigator.vendor ?? '',
      lite: document.documentElement.hasAttribute('data-lite'),
      saveData: connection?.saveData,
      effectiveType: connection?.effectiveType,
    });
    if (!animate) return;

    const onPlaying = () => setPlaying(true);
    const start = () => {
      video.src = VIDEO_SRC;
      video.play().catch(() => undefined);
    };
    video.addEventListener('playing', onPlaying);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    const observer = new IntersectionObserver(([entry]) => {
      if (!video.src) return;
      if (entry?.isIntersecting) video.play().catch(() => undefined);
      else video.pause();
    });
    observer.observe(video);

    return () => {
      observer.disconnect();
      window.removeEventListener('load', start);
      video.removeEventListener('playing', onPlaying);
      video.pause();
    };
  }, []);

  return (
    <span className={styles.mascotWrap}>
      <Image
        className={styles.mascot}
        data-hidden={playing || undefined}
        src="/brand/mascot-poster.png"
        width={640}
        height={838}
        sizes="(max-width: 719px) 240px, 336px"
        alt=""
        preload
        fetchPriority="high"
      />
      <video
        ref={videoRef}
        className={styles.mascotVideo}
        data-on={playing || undefined}
        width={640}
        height={838}
        muted
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
        preload="none"
        aria-hidden="true"
        tabIndex={-1}
      />
    </span>
  );
}
