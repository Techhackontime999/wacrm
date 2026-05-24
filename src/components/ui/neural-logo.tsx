function NeuralIcon({ size = 28 }: { size?: number }) {
  const s = size / 100;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <g className="animate-[spin_30s_linear_infinite] origin-[50%_50%]">
        <circle cx="50" cy="50" r="28" stroke="#7F77DD" strokeOpacity={0.15} strokeWidth={1 * s} strokeDasharray="5 5" />
        <circle cx="50" cy="50" r="18" stroke="#7F77DD" strokeOpacity={0.06} strokeWidth={1 * s} />
      </g>

      <g stroke="#5DCAA5" strokeOpacity={0.25} strokeWidth={0.8 * s}>
        <line x1={50 * s} y1={50 * s} x2={22.5 * s} y2={26 * s} className="animate-[pulse_3s_ease-in-out_infinite]" />
        <line x1={50 * s} y1={50 * s} x2={17.5 * s} y2={55 * s} className="animate-[pulse_3s_ease-in-out_infinite_0.5s]" />
        <line x1={50 * s} y1={50 * s} x2={27.5 * s} y2={80 * s} className="animate-[pulse_3s_ease-in-out_infinite_1s]" />
        <line x1={50 * s} y1={50 * s} x2={61 * s} y2={16 * s} className="animate-[pulse_3s_ease-in-out_infinite_1.5s]" />
        <line x1={50 * s} y1={50 * s} x2={84 * s} y2={31 * s} className="animate-[pulse_3s_ease-in-out_infinite_2s]" />
        <line x1={50 * s} y1={50 * s} x2={85 * s} y2={64 * s} className="animate-[pulse_3s_ease-in-out_infinite_2.5s]" />
        <line x1={50 * s} y1={50 * s} x2={70 * s} y2={85 * s} className="animate-[pulse_3s_ease-in-out_infinite_3s]" />
      </g>

      <g stroke="#7F77DD" strokeOpacity={0.12} strokeWidth={0.6 * s}>
        <line x1={22.5 * s} y1={26 * s} x2={61 * s} y2={16 * s} />
        <line x1={61 * s} y1={16 * s} x2={84 * s} y2={31 * s} />
        <line x1={84 * s} y1={31 * s} x2={85 * s} y2={64 * s} />
        <line x1={85 * s} y1={64 * s} x2={70 * s} y2={85 * s} />
        <line x1={70 * s} y1={85 * s} x2={27.5 * s} y2={80 * s} />
        <line x1={27.5 * s} y1={80 * s} x2={17.5 * s} y2={55 * s} />
        <line x1={17.5 * s} y1={55 * s} x2={22.5 * s} y2={26 * s} />
      </g>

      {[
        { cx: 22.5, cy: 26, r: 3.5, delay: 0 },
        { cx: 17.5, cy: 55, r: 3, delay: 0.6 },
        { cx: 27.5, cy: 80, r: 3.5, delay: 1.2 },
        { cx: 61, cy: 16, r: 3, delay: 1.8 },
        { cx: 84, cy: 31, r: 4, delay: 2.4 },
        { cx: 85, cy: 64, r: 3, delay: 3 },
        { cx: 70, cy: 85, r: 3.5, delay: 3.6 },
      ].map((node) => (
        <circle
          key={node.cx}
          cx={node.cx * s}
          cy={node.cy * s}
          r={node.r * s}
          fill="#AFA9EC"
          stroke="#7F77DD"
          strokeWidth={0.8 * s}
          className="animate-[pulse_2.5s_ease-in-out_infinite]"
          style={{ animationDelay: `${node.delay}s` }}
        />
      ))}

      <circle
        cx={50 * s}
        cy={50 * s}
        r={10 * s}
        fill="url(#orbFill)"
        fillOpacity={0.38}
        className="animate-[pulse_4s_ease-in-out_infinite]"
      />
      <circle cx={50 * s} cy={50 * s} r={5.5 * s} fill="url(#orbCore)" fillOpacity={0.95} />
      <circle cx={48.5 * s} cy={48.5 * s} r={2 * s} fill="white" fillOpacity={0.5} />

      <defs>
        <linearGradient id="orbFill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#AFA9EC" />
          <stop offset="100%" stopColor="#5DCAA5" />
        </linearGradient>
        <linearGradient id="orbCore" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#EEEDFE" />
          <stop offset="100%" stopColor="#9FE1CB" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function NeuralLogo({ size = "default" }: { size?: "default" | "small" | "large" }) {
  const iconSize = size === "small" ? 20 : size === "large" ? 48 : 28;
  const isSmall = size === "small";

  return (
    <div className="inline-flex items-center gap-1.5">
      <NeuralIcon size={iconSize} />
      <div className="flex flex-col leading-none">
        <span
          className={`font-bold tracking-tight ${
            isSmall ? "text-sm" : "text-base"
          } bg-gradient-to-r from-[#EEEDFE] via-[#AFA9EC] to-[#7F77DD] bg-clip-text text-transparent`}
        >
          NEURAL
        </span>
        <span
          className={`font-light tracking-[0.15em] ${
            isSmall ? "text-[10px]" : "text-xs"
          } bg-gradient-to-r from-[#5DCAA5] to-[#1D9E75] bg-clip-text text-transparent`}
        >
          AURORA
        </span>
      </div>
    </div>
  );
}
