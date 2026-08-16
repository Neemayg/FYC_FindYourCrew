import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
  glassmorphism?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  hoverEffect = false,
  glassmorphism = true,
  className = '',
  ...props
}) => {
  const baseStyle = 'rounded-2xl border p-6 transition-all duration-300';
  
  const glassStyles = glassmorphism
    ? 'bg-zinc-900/60 backdrop-blur-md border-zinc-800/80 shadow-xl shadow-black/10'
    : 'bg-zinc-900 border-zinc-800 shadow-lg';

  const hoverStyle = hoverEffect
    ? 'hover:-translate-y-1 hover:border-zinc-700/80 hover:shadow-zinc-950/40 hover:bg-zinc-900/80'
    : '';

  return (
    <div
      className={`${baseStyle} ${glassStyles} ${hoverStyle} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`mb-4 flex items-center justify-between ${className}`} {...props}>
    {children}
  </div>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`text-zinc-400 text-sm leading-relaxed ${className}`} {...props}>
    {children}
  </div>
);
