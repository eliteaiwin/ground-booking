export default function AppLogo({ size = 40 }: { size?: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <img src="/app-logo.png" alt="Elite Turf Booking" className="w-full h-full rounded-xl object-cover shadow" />
      <span className="absolute -bottom-1 -right-1 leading-none" style={{ fontSize: size * 0.45 }} aria-hidden>&#9917;</span>
    </span>
  );
}
