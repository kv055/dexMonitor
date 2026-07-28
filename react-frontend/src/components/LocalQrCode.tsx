import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface LocalQrCodeProps {
  value: string;
  alt: string;
  size: number;
  className?: string;
  fallback: string;
}

interface QrCodeResult {
  value: string;
  dataUrl?: string;
  error?: string;
}

export function LocalQrCode({
  value,
  alt,
  size,
  className = '',
  fallback,
}: LocalQrCodeProps) {
  const [result, setResult] = useState<QrCodeResult | null>(null);
  const currentResult = result?.value === value ? result : null;

  useEffect(() => {
    let active = true;

    void QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size * 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then(dataUrl => {
        if (active) setResult({ value, dataUrl });
      })
      .catch(error => {
        if (!active) return;
        setResult({
          value,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      active = false;
    };
  }, [size, value]);

  if (currentResult?.dataUrl) {
    return (
      <img
        src={currentResult.dataUrl}
        width={size}
        height={size}
        alt={alt}
        className={className}
      />
    );
  }

  return (
    <div
      role={currentResult?.error ? 'alert' : 'status'}
      aria-label={alt}
      aria-busy={!currentResult?.error}
      title={currentResult?.error}
      className={`grid place-items-center bg-white text-center text-[0.58rem] leading-tight text-slate-600 ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="px-2">
        {currentResult?.error ? fallback : 'Generating QR code…'}
      </span>
    </div>
  );
}
