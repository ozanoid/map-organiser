export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      {children}
    </div>
  );
}
