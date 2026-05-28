interface MapLoadingOverlayProps {
  message?: string;
}

export function MapLoadingOverlay({
  message = "Loading map…",
}: MapLoadingOverlayProps) {
  return (
    <div className="map-loading-overlay" role="status" aria-live="polite">
      <div className="map-loading-spinner" aria-hidden />
      <p className="map-loading-message">{message}</p>
    </div>
  );
}
