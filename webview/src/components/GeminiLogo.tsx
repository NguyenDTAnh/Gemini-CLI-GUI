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
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Lớp bóng mờ tạo vibe Premium */}
      <path 
        d="M12 3C12 3 13.5 10.5 21 12C13.5 13.5 12 21 12 21C12 21 10.5 13.5 3 12C10.5 10.5 12 3 12 3Z" 
        stroke={useGradient ? "url(#primary-gradient)" : "currentColor"} 
        strokeWidth="1.5"
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ opacity: 0.4, filter: 'blur(0.5px)' }}
      />
      {/* Lớp nét chính */}
      <path 
        d="M12 3C12 3 13.5 10.5 21 12C13.5 13.5 12 21 12 21C12 21 10.5 13.5 3 12C10.5 10.5 12 3 12 3Z" 
        stroke={useGradient ? "url(#primary-gradient)" : "currentColor"} 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      {/* Điểm nhấn ở tâm tạo chiều sâu */}
      <circle 
        cx="12" 
        cy="12" 
        r="1" 
        fill={useGradient ? "url(#primary-gradient)" : "currentColor"}
      />
    </svg>
  );
};
