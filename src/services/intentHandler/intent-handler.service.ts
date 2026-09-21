import { inject, Injectable, NgZone } from '@angular/core';

import { App, URLOpenListenerEvent } from '@capacitor/app';

import IntentHandlerTracking from '../../data/tracking/intentHandlerTracking';
import QR_TRACKING from '../../data/tracking/qrTracking';
import { BEAN_CODE_ACTION } from '../../enums/beans/beanCodeAction';
import { ServerBean } from '../../models/bean/serverBean';
import { BrewImportService } from '../brewImport/brew-import.service';
import { ServerCommunicationService } from '../serverCommunication/server-communication.service';
import { UIAlert } from '../uiAlert';
import { UIAnalytics } from '../uiAnalytics';
import { UIBeanHelper } from '../uiBeanHelper';
import { UIBrewHelper } from '../uiBrewHelper';
import { UIHelper } from '../uiHelper';
import { UILog } from '../uiLog';
import { VisualizerService } from '../visualizerService/visualizer-service.service';
import {
  collectHandoffPayload,
  decodeHandoffPayload,
} from './brew-handoff.decoder';

@Injectable({
  providedIn: 'root',
})
export class IntentHandlerService {
  private readonly uiHelper = inject(UIHelper);
  private readonly uiLog = inject(UILog);
  private readonly serverCommunicationService = inject(
    ServerCommunicationService,
  );
  private readonly uiBeanHelper = inject(UIBeanHelper);
  private readonly uiBrewHelper = inject(UIBrewHelper);
  private readonly uiAlert = inject(UIAlert);
  private readonly uiAnalytics = inject(UIAnalytics);
  private readonly visualizerService = inject(VisualizerService);
  private readonly brewImportService = inject(BrewImportService);
  private readonly zone = inject(NgZone);

  public static SUPPORTED_INTENTS = {
    ADD_BEAN_ONLINE: 'ADD_BEAN_ONLINE',
    ADD_USER_BEAN: 'ADD_USER_BEAN',
    ADD_BREW: 'ADD_BREW',
  };

  public attachOnHandleOpenUrl() {
    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      this.zone.run(() => {
        this.uiLog.log('Deeplink matched', event);
        this.handleDeepLink(event.url);
      });
    });
  }

  public async handleQRCodeLink(_url) {
    await this.uiHelper.isBeanconqurorAppReady().then(async () => {
      const url: string = _url;
      this.uiLog.log('Handle QR Code Link: ' + url);
      await this.handleDeepLink(_url);
    });
  }

  public async handleDeepLink(_url) {
    try {
      if (_url) {
        await this.uiHelper.isBeanconqurorAppReady().then(async () => {
          const url: string = _url;
          this.uiLog.log('Handle deeplink: ' + url);
          const urlParams = new URLSearchParams(url.split('?')[1]);
          if (
            url.indexOf('https://beanconqueror.com/?qr=') === 0 ||
            url.indexOf('https://beanconqueror.com?qr=') === 0 ||
            url.indexOf('?qr=') >= 0
          ) {
            const qrCodeId: string = urlParams.get('qr');
            await this.addBeanFromServer(qrCodeId);
          } else if (
            url
              .toLowerCase()
              .indexOf('beanconqueror://ADD_BEAN_ONLINE'.toLowerCase()) === 0
          ) {
            const qrCodeId: string = urlParams.get('id');
            await this.addBeanFromServer(qrCodeId);
          } else if (
            url.indexOf('https://beanconqueror.com/?shareUserBean0=') === 0 ||
            url.indexOf('https://beanconqueror.com?shareUserBean0=') === 0 ||
            url.indexOf('?shareUserBean0=') >= 0
          ) {
            let userBeanJSON: string = '';

            const regex = /((shareUserBean)[0-9]+(?=\=))/gi;
            const foundJSONParams = url.match(regex);
            try {
              for (const param of foundJSONParams) {
                userBeanJSON += String(urlParams.get(param));
              }
            } catch (ex) {}
            this.uiLog.log('Found shared bean ' + userBeanJSON);
            if (userBeanJSON) {
              /*
               * Android import is replacing the "+" with spaces when using the params, therefore we need to revert it.
               */
              userBeanJSON = userBeanJSON.replace(/ /g, '+');
              await this.addBeanFromUser(userBeanJSON);
            }
          } else if (
            url
              .toLowerCase()
              .indexOf('beanconqueror://ADD_USER_BEAN'.toLowerCase()) === 0
          ) {
            let userBeanJSON: string = '';

            const regex = /((shareUserBean)[0-9]+(?=\=))/gi;
            const foundJSONParams = url.match(regex);
            for (const param of foundJSONParams) {
              userBeanJSON += String(urlParams.get(param));
            }
            if (userBeanJSON) {
              /*
               * Android import is replacing the "+" with spaces when using the params, therefore we need to revert it.
               */
              userBeanJSON = userBeanJSON.replace(/ /g, '+');
              await this.addBeanFromUser(userBeanJSON);
            }
          } else if (
            url
              .toLowerCase()
              .indexOf('beanconqueror://ADD_BREW'.toLowerCase()) === 0
          ) {
            await this.addBrewFromHandoff(url);
          } else if (
            url
              .toLowerCase()
              .indexOf('beanconqueror://VISUALIZER_SHARE'.toLowerCase()) === 0
          ) {
            const visualizerShareCode = String(urlParams.get('code'));

            this.importVisualizerShot(visualizerShareCode);
          } else if (
            url.indexOf('https://beanconqueror.com/?visualizerShare=') === 0 ||
            url.indexOf('https://beanconqueror.com?visualizerShare=') === 0 ||
            url.indexOf('?visualizerShare=') >= 0
          ) {
            /*e.g: "https://beanconqueror.com/app/visualizer/importVisualizer.html?visualizerShare=JRKJ"*/
            const visualizerShareCode = String(
              urlParams.get('visualizerShare'),
            );

            this.importVisualizerShot(visualizerShareCode);
          } else if (url.indexOf('bean.html') >= 0) {
            /**
             * On Android the whole path is directly resolved, therefore its the new url used**/
            const qrCodeId: string = urlParams.get('id');
            await this.addBeanFromServer(qrCodeId);
          } else if (url.indexOf('int/') > 0) {
            //We got an internal call ihr right now :)
            // Split into type, id, action ['bean', '3E95E1', 'START_BREW']
            const data = url.split('int/')[1].split('/');
            const actionType = data[0];
            const id = data[1];
            let action = data[2];
            try {
              this.uiAnalytics.trackEvent(
                IntentHandlerTracking.TITLE,
                IntentHandlerTracking.ACTIONS.INTERNAL_CALL,
                action as BEAN_CODE_ACTION,
              );
            } catch (ex) {}
            if (actionType === 'bean') {
              if (
                (action as BEAN_CODE_ACTION) === BEAN_CODE_ACTION.CHOOSE_ACTION
              ) {
                //We overwrite action here :)
                action = await this.uiBeanHelper.chooseNFCTagAction();
              }

              if ((action as BEAN_CODE_ACTION) === BEAN_CODE_ACTION.DETAIL) {
                await this.uiBeanHelper.detailBeanByInternalShareCode(id);
              } else if (
                (action as BEAN_CODE_ACTION) === BEAN_CODE_ACTION.EDIT
              ) {
                await this.uiBeanHelper.editBeanByInternalShareCode(id);
              } else if (
                (action as BEAN_CODE_ACTION) === BEAN_CODE_ACTION.START_BREW
              ) {
                await this.uiBrewHelper.startBrewForBeanByInternalShareCode(id);
              } else if (
                (action as BEAN_CODE_ACTION) ===
                BEAN_CODE_ACTION.START_BREW_CHOOSE_PREPARATION
              ) {
                await this.uiBrewHelper.startBrewAndChoosePreparationMethodForBeanByInternalShareCode(
                  id,
                );
              } else if (
                (action as BEAN_CODE_ACTION) ===
                BEAN_CODE_ACTION.REPEAT_LAST_BREW
              ) {
                await this.uiBrewHelper.repeatLastBrewForBeanByInternalShareCode(
                  id,
                );
              }
            }
          } else {
            this.uiAlert.showMessage(
              'QR.WRONG_QRCODE_DESCRIPTION',
              'QR.WRONG_QRCODE_TITLE',
              undefined,
              true,
            );
          }
        });
      }
    } catch (ex) {
      if (this.uiAlert.isLoadingSpinnerShown()) {
        this.uiAlert.hideLoadingSpinner();
      }
      this.uiLog.error('Handle Deep link failed: ' + ex.message);
    }
  }

  /**
   * Receive a brew handed over from another app.
   *
   * The payload arrives split across numbered `shareBrew` parameters, exactly
   * as the bean share does, because a single parameter long enough to hold a
   * whole brew is truncated by the OS. The decoder is the trust boundary: it
   * validates before anything reaches storage, and every rejection carries a
   * specific reason, so the log says what was wrong rather than only that
   * something was.
   */
  private async addBrewFromHandoff(_url: string) {
    this.uiLog.log('Import brew from handoff link');

    // An imported brew is linked to a bean, a preparation method and a grinder
    // just like a hand-entered one, so an empty library fails it for the same
    // reason a new brew cannot be started. Ask first and reuse that answer:
    // "the brew could not be read" would blame the link for a missing bean.
    if (this.uiBrewHelper.canBrewIfNotShowMessage() === false) {
      this.uiLog.log('Import brew from handoff link skipped: cannot brew yet');
      return;
    }

    try {
      await this.uiAlert.showLoadingSpinner();
      this.uiAnalytics.trackEvent(
        IntentHandlerTracking.TITLE,
        IntentHandlerTracking.ACTIONS.ADD_HANDOFF_BREW,
      );
      const envelope = await decodeHandoffPayload(collectHandoffPayload(_url));
      await this.brewImportService.import(envelope);
      await this.uiAlert.hideLoadingSpinner();
      this.uiAlert.showMessage(
        'BREW_IMPORT_SUCCESSFUL',
        undefined,
        undefined,
        true,
      );
    } catch (ex) {
      this.uiLog.error('Import brew from handoff link failed: ' + ex.message);
      await this.uiAlert.hideLoadingSpinner();
      this.uiAlert.showMessage(
        'BREW_IMPORT_FAILED',
        'ERROR_OCCURED',
        undefined,
        true,
      );
    }
  }

  private importVisualizerShot(_shareCode) {
    this.uiAnalytics.trackEvent(
      IntentHandlerTracking.TITLE,
      IntentHandlerTracking.ACTIONS.VISUALIZER_IMPORT,
    );
    this.visualizerService.importShotWithSharedCode(_shareCode);
  }
  public async addBeanFromServer(_qrCodeId: string) {
    this.uiLog.log('Load bean information from server: ' + _qrCodeId);

    try {
      await this.uiAlert.showLoadingSpinner();
      this.uiAnalytics.trackEvent(
        IntentHandlerTracking.TITLE,
        IntentHandlerTracking.ACTIONS.IMPORT_ROASTER_BEAN,
        _qrCodeId,
      );
      const beanData: ServerBean =
        await this.serverCommunicationService.getBeanInformation(_qrCodeId);
      await this.uiBeanHelper.addScannedQRBean(beanData);
    } catch (ex) {
      this.uiAnalytics.trackEvent(
        QR_TRACKING.TITLE,
        QR_TRACKING.ACTIONS.SCAN_FAILED,
      );
      await this.uiAlert.hideLoadingSpinner();
      this.uiAlert.showMessage(
        'QR.SERVER.ERROR_OCCURED',
        'ERROR_OCCURED',
        undefined,
        true,
      );
    }
  }

  public async addBeanFromUser(_userBeanJSON: string) {
    this.uiLog.log(
      'Load bean information from shared user context: ' + _userBeanJSON,
    );

    try {
      await this.uiAlert.showLoadingSpinner();
      this.uiAnalytics.trackEvent(
        IntentHandlerTracking.TITLE,
        IntentHandlerTracking.ACTIONS.ADD_USER_SHARED_BEAN,
      );
      await this.uiBeanHelper.addUserSharedBean(_userBeanJSON);
    } catch (ex) {
      this.uiAnalytics.trackEvent(
        QR_TRACKING.TITLE,
        QR_TRACKING.ACTIONS.SCAN_FAILED,
      );
      await this.uiAlert.hideLoadingSpinner();
      this.uiAlert.showMessage(
        'QR.SERVER.ERROR_OCCURED',
        'ERROR_OCCURED',
        undefined,
        true,
      );
    }
  }
}
