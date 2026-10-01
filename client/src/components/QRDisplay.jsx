import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

export default function QRDisplay({ token, rotationInterval = 60000 }) {
  const [timeLeft, setTimeLeft] = useState(rotationInterval / 1000);
  
  useEffect(() => {
    setTimeLeft(rotationInterval / 1000);
    
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          return rotationInterval / 1000;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [token, rotationInterval]);
  
  if (!token) {
    return (
      <div className="flex items-center justify-center p-8 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <p className="text-muted-foreground">No QR code available</p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col items-center space-y-4 p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      <div className="p-4 bg-white rounded-lg">
        <QRCodeSVG value={token} size={256} level="H" />
      </div>
      
      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
        <RefreshCw size={16} className="animate-spin" />
        <span>Refreshes in {timeLeft}s</span>
      </div>
      
      <p className="text-xs text-center text-muted-foreground max-w-xs">
        Students must scan this QR code to mark their attendance
      </p>
    </div>
  );
}
