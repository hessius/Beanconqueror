import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { IHandoffEnvelope } from '../../../interfaces/brew/IHandoff';
import { BrewImportService } from '../../brewImport/brew-import.service';
import { ServerCommunicationService } from '../../serverCommunication/server-communication.service';
import { UIAlert } from '../../uiAlert';
import { UIAnalytics } from '../../uiAnalytics';
import { UIBeanHelper } from '../../uiBeanHelper';
import { UIBrewHelper } from '../../uiBrewHelper';
import { UIHelper } from '../../uiHelper';
import { UILog } from '../../uiLog';
import { VisualizerService } from '../../visualizerService/visualizer-service.service';
import { IntentHandlerService } from '../intent-handler.service';

async function gzipBase64Url(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const gzipped = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  gzipped.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function handoffUrl(payload: string): string {
  const chunks = payload.match(/.{1,400}/g) ?? [''];
  const params = [`len=${payload.length}`];
  chunks.forEach((chunk, index) => {
    params.push(`shareBrew${index}=${chunk}`);
  });
  return `beanconqueror://ADD_BREW?${params.join('&')}`;
}

function validEnvelope(): IHandoffEnvelope {
  return {
    v: 1,
    app: { name: 'Sender', version: '1.0' },
    brew: {
      date: '2026-09-20T12:00:00.000Z',
      doseIn: { value: 18, unit: 'g' },
      waterIn: { value: 300, unit: 'ml' },
      beverageOut: { value: 240, unit: 'g' },
      brewTime: 210,
      temperature: 93,
      ratio: 16.7,
      grindSize: '42',
      grinderRpm: 60,
      grinderName: 'Any grinder',
      preparationMethod: 'Any brewer',
      bloomTime: 35,
      firstDripTime: 12,
      note: 'A completed brew',
    },
    bean: { name: 'Any coffee' },
    flow: {
      fidelity: 'full',
      t: [0, 1000, 1000],
      waterDispensed: [0, 125, 125],
      weight: [0, 50, 75],
      temperature: [91, 92, 93],
    },
    metrics: [
      {
        key: 'targetTemperature',
        name: 'Target temp',
        unit: '°C',
        kind: 'target',
        t: [0, 200000],
        v: [93, 93],
      },
    ],
    imported: {
      source: 'any-sender',
      sourceName: 'Any Sender',
      sourceUrl: 'https://example.com/brew/1',
      device: 'Any brewer',
      schema: 1,
      params: { recipe: 'abc123' },
    },
  };
}

describe('IntentHandlerService', () => {
  let service: IntentHandlerService;
  let uiHelper: jasmine.SpyObj<UIHelper>;
  let uiLog: jasmine.SpyObj<UILog>;
  let serverCommunicationService: jasmine.SpyObj<ServerCommunicationService>;
  let uiBeanHelper: jasmine.SpyObj<UIBeanHelper>;
  let uiBrewHelper: jasmine.SpyObj<UIBrewHelper>;
  let uiAlert: jasmine.SpyObj<UIAlert>;
  let uiAnalytics: jasmine.SpyObj<UIAnalytics>;
  let visualizerService: jasmine.SpyObj<VisualizerService>;
  let brewImportService: jasmine.SpyObj<BrewImportService>;
  let envelope: IHandoffEnvelope;
  let url: string;

  beforeEach(async () => {
    uiHelper = jasmine.createSpyObj('UIHelper', ['isBeanconqurorAppReady']);
    uiLog = jasmine.createSpyObj('UILog', ['log', 'error']);
    serverCommunicationService = jasmine.createSpyObj(
      'ServerCommunicationService',
      ['getBeanInformation'],
    );
    uiBeanHelper = jasmine.createSpyObj('UIBeanHelper', [
      'addScannedQRBean',
      'addUserSharedBean',
      'chooseNFCTagAction',
      'detailBeanByInternalShareCode',
      'editBeanByInternalShareCode',
    ]);
    uiBrewHelper = jasmine.createSpyObj('UIBrewHelper', [
      'canBrewIfNotShowMessage',
      'startBrewForBeanByInternalShareCode',
      'startBrewAndChoosePreparationMethodForBeanByInternalShareCode',
      'repeatLastBrewForBeanByInternalShareCode',
    ]);
    uiAlert = jasmine.createSpyObj('UIAlert', [
      'showLoadingSpinner',
      'hideLoadingSpinner',
      'showMessage',
      'isLoadingSpinnerShown',
    ]);
    uiAnalytics = jasmine.createSpyObj('UIAnalytics', ['trackEvent']);
    visualizerService = jasmine.createSpyObj('VisualizerService', [
      'importShotWithSharedCode',
    ]);
    brewImportService = jasmine.createSpyObj('BrewImportService', ['import']);

    uiHelper.isBeanconqurorAppReady.and.resolveTo();
    uiAlert.showLoadingSpinner.and.resolveTo();
    uiAlert.hideLoadingSpinner.and.resolveTo();
    uiAlert.isLoadingSpinnerShown.and.returnValue(false);
    brewImportService.import.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        IntentHandlerService,
        { provide: UIHelper, useValue: uiHelper },
        { provide: UILog, useValue: uiLog },
        {
          provide: ServerCommunicationService,
          useValue: serverCommunicationService,
        },
        { provide: UIBeanHelper, useValue: uiBeanHelper },
        { provide: UIBrewHelper, useValue: uiBrewHelper },
        { provide: UIAlert, useValue: uiAlert },
        { provide: UIAnalytics, useValue: uiAnalytics },
        { provide: VisualizerService, useValue: visualizerService },
        { provide: BrewImportService, useValue: brewImportService },
        {
          provide: NgZone,
          useValue: jasmine.createSpyObj('NgZone', {
            run: (fn: () => unknown) => fn(),
          }),
        },
      ],
    });

    service = TestBed.inject(IntentHandlerService);
    envelope = validEnvelope();
    url = handoffUrl(await gzipBase64Url(envelope));
  });

  it('blocks brew handoff import when the library cannot start a brew', async () => {
    uiBrewHelper.canBrewIfNotShowMessage.and.returnValue(false);

    await service.handleDeepLink(url);

    expect(uiBrewHelper.canBrewIfNotShowMessage).toHaveBeenCalled();
    expect(brewImportService.import).not.toHaveBeenCalled();
    expect(uiAlert.showLoadingSpinner).not.toHaveBeenCalled();
    expect(uiAlert.showMessage).not.toHaveBeenCalledWith(
      'BREW_IMPORT_FAILED',
      'ERROR_OCCURED',
      undefined,
      true,
    );
  });

  it('imports a brew handoff when the library can start a brew', async () => {
    uiBrewHelper.canBrewIfNotShowMessage.and.returnValue(true);

    await service.handleDeepLink(url);

    expect(uiLog.log).toHaveBeenCalledWith(
      `Handle deeplink: ADD_BREW (${url.length} chars)`,
    );
    expect(uiLog.log).not.toHaveBeenCalledWith('Handle deeplink: ' + url);
    expect(brewImportService.import).toHaveBeenCalledOnceWith(envelope);
    expect(uiAlert.showMessage).toHaveBeenCalledWith(
      'BREW_IMPORT_SUCCESSFUL',
      undefined,
      undefined,
      true,
    );
  });

  it('reports a brew handoff import failure after a decodable payload reaches import', async () => {
    uiBrewHelper.canBrewIfNotShowMessage.and.returnValue(true);
    brewImportService.import.and.rejectWith(new Error('Import failed'));

    await service.handleDeepLink(url);

    expect(brewImportService.import).toHaveBeenCalled();
    expect(uiAlert.hideLoadingSpinner).toHaveBeenCalled();
    expect(uiAlert.showMessage).toHaveBeenCalledWith(
      'BREW_IMPORT_FAILED',
      'ERROR_OCCURED',
      undefined,
      true,
    );
  });
});
