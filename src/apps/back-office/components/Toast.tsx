import { useEffect, useState } from 'react';

type ToastItem = { id: number; message: string; tone: 'error' | 'warning' | 'success' };

export function ToastHost({ message, error, onDismiss }: { message?: string; error?: string; onDismiss?: () => void }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const handleApiError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; status?: number }>).detail;
      const message = detail?.message?.trim();
      if (!message) return;
      const id = Date.now() + Math.random();
      setItems((current) => current.some((item) => item.message === message) ? current : [...current.slice(-2), { id, message, tone: detail.status === 402 || detail.status === 409 ? 'warning' : 'error' }]);
      window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 6000);
    };
    window.addEventListener('dhmis:api-error', handleApiError);
    return () => window.removeEventListener('dhmis:api-error', handleApiError);
  }, []);
  useEffect(() => {
    const text = message?.trim();
    if (!text) return;
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-2), { id, message: text, tone: 'success' }]);
    const timer = window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const text = error?.trim();
    if (!text) return;
    const id = Date.now() + Math.random();
    setItems((current) => current.some((item) => item.message === text) ? current : [...current.slice(-2), { id, message: text, tone: 'error' }]);
    const timer = window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);
  if (!items.length) return null;
  return <div className="dhmis-toast-stack" aria-live="polite">{items.map((item) => <div key={item.id} className={`dhmis-toast dhmis-toast-${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}><span>{item.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => { setItems((current) => current.filter((entry) => entry.id !== item.id)); onDismiss?.(); }}>×</button></div>)}</div>;
}
