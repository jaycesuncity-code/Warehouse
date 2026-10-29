import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'neutral' | 'danger';
const cls = (v: ButtonVariant, extra = '') => `btn btn-${v} ${extra}`;

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
}

export function Button({ variant = 'primary', block, className = '', type = 'button', ...rest }: BtnProps) {
  return <button type={type} className={cls(variant, `${block ? 'w-full' : ''} ${className}`)} {...rest} />;
}

interface LinkBtnProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  block?: boolean;
  children: ReactNode;
}

export function LinkButton({ variant = 'primary', block, className = '', ...rest }: LinkBtnProps) {
  return <a className={cls(variant, `${block ? 'w-full' : ''} ${className}`)} {...rest} />;
}
