import type { SocialModule } from '../../plugin.interface';
import type { AdbService } from '../../../adb/adb.service';

export const facebookModule: SocialModule = {
  id: 'facebook',
  displayName: 'Facebook',
  packageName: 'com.facebook.katana',
  activity: '.LoginActivity',
  canInstallFromApk: true,
  open(serial: string, adbService: AdbService) {
    return adbService.openApp(serial, this.packageName, this.activity);
  },
  close(serial: string, adbService: AdbService) {
    return adbService.closeApp(serial, this.packageName);
  }
};
