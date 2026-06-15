import { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

export default function Container({ children, className = '' }: Props) {
  return <div className={`max-w-7xl mx-auto px-8 ${className}`}>{children}</div>;
}
