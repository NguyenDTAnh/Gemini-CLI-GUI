import React from 'react';

interface GeminiLogoProps {
  size?: number;
  className?: string;
  useGradient?: boolean;
}

export const GeminiLogo: React.FC<GeminiLogoProps> = ({ 
  size = 24, 
  className = "", 
  useGradient = true 
}) => {
  const gradientId = useGradient ? "url(#primary-gradient)" : "currentColor";
  
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path 
        d="M12 3C12 3 13.5 10.5 21 12C13.5 13.5 12 21 12 21C12 21 10.5 13.5 3 12C10.5 10.5 12 3 12 3Z" 
        stroke={gradientId}
        strokeWidth="1.5"
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ opacity: 0.4, filter: 'blur(0.5px)' }}
      />
      <path 
        d="M12 3C12 3 13.5 10.5 21 12C13.5 13.5 12 21 12 21C12 21 10.5 13.5 3 12C10.5 10.5 12 3 12 3Z" 
        stroke={gradientId}
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <circle 
        cx="12" 
        cy="12" 
        r="1" 
        fill={gradientId}
      />
    </svg>
  );
};
