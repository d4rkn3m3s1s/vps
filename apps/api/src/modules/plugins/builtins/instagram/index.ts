import type { SocialModule } from '../../plugin.interface';
import type { AdbService } from '../../../adb/adb.service';

export const instagramModule: SocialModule = {
  id: 'instagram',
  displayName: 'Instagram',
  packageName: 'com.instagram.android',
  activity: '.activity.MainTabActivity',
  canInstallFromApk: true,
  open(serial: string, adbService: AdbService) {
    return adbService.openApp(serial, this.packageName, this.activity);
  },
  close(serial: string, adbService: AdbService) {
    return adbService.closeApp(serial, this.packageName);
  }
};
