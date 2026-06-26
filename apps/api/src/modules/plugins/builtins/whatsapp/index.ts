import type { SocialModule } from '../../plugin.interface';
import type { AdbService } from '../../../adb/adb.service';

export const whatsappModule: SocialModule = {
  id: 'whatsapp',
  displayName: 'WhatsApp',
  packageName: 'com.whatsapp',
  activity: 'com.whatsapp.HomeActivity',
  canInstallFromApk: true,
  open(serial: string, adbService: AdbService) {
    return adbService.openApp(serial, this.packageName, this.activity);
  },
  close(serial: string, adbService: AdbService) {
    return adbService.closeApp(serial, this.packageName);
  }
};
