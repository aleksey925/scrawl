export function iosHomeScreenApp(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true;
}
