import { TestBed } from '@angular/core/testing';

import { TranslateService } from '@ngx-translate/core';

import { Bean } from '../../../classes/bean/bean';
import { Brew, BrewInstanceHelper } from '../../../classes/brew/brew';
import { Mill } from '../../../classes/mill/mill';
import { Preparation } from '../../../classes/preparation/preparation';
import { Settings } from '../../../classes/settings/settings';
import type { IHandoffEnvelope } from '../../../interfaces/brew/IHandoff';
import { decodeHandoffPayload } from '../../intentHandler/brew-handoff.decoder';
import { UIBeanStorage } from '../../uiBeanStorage';
import { UIBrewStorage } from '../../uiBrewStorage';
import { UIFileHelper } from '../../uiFileHelper';
import { UIMillStorage } from '../../uiMillStorage';
import { UIPreparationStorage } from '../../uiPreparationStorage';
import { UISettingsStorage } from '../../uiSettingsStorage';
import { BrewImportService } from '../brew-import.service';

function envelope(overrides: Partial<IHandoffEnvelope> = {}): IHandoffEnvelope {
  return {
    v: 1,
    app: { name: 'Any Sender', version: '1.0' },
    brew: {
      date: '2026-09-20T12:34:56.000Z',
      doseIn: { value: 18, unit: 'g' },
      waterIn: { value: 300, unit: 'ml' },
      beverageOut: { value: 240, unit: 'g' },
      brewTime: 210.25,
      temperature: 93,
      grindSize: '7.2',
      grinderRpm: 60,
      grinderName: 'Any grinder',
      preparationMethod: 'Any brewer',
      bloomTime: 35,
      firstDripTime: 12.5,
      note: 'A completed brew',
    },
    bean: { name: 'Any coffee' },
    flow: {
      fidelity: 'full',
      t: [0, 1000, 250],
      waterDispensed: [0, 125, 25],
      weight: [0, 50, 75],
      temperature: [91, 92, 93],
    },
    metrics: [
      {
        key: 'targetTemperature',
        name: 'Temperature',
        unit: '°C',
        kind: 'target',
        t: [0, 45000],
        v: [93, 91],
      },
      {
        key: 'measuredAgitation',
        name: 'Agitation',
        unit: 'rpm',
        kind: 'measured',
        t: [10000],
        v: [120],
      },
    ],
    imported: {
      source: 'any-sender',
      sourceName: 'Any Sender',
      sourceUrl: 'https://example.com/brews/1',
      device: 'Any brewer',
      schema: 1,
      params: { opaque: ['keep', 123] },
    },
    ...overrides,
  };
}

function entry<T extends Bean | Mill | Preparation>(
  model: T,
  name: string,
  uuid: string,
): T {
  model.name = name;
  model.config.uuid = uuid;
  return model;
}

function cloneBrew(brew: Brew): Brew {
  const cloned = new Brew();
  cloned.initializeByObject(JSON.parse(JSON.stringify(brew)));
  return cloned;
}

async function encodeEnvelopeForDecoder(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });

  let binary = '';
  out.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

class MemoryBrewStorage {
  private entries: Brew[] = [];
  public failUpdate = false;

  public add = jasmine
    .createSpy('add')
    .and.callFake((brew: Brew): Promise<Brew> => {
      const stored = cloneBrew(brew);
      stored.config.uuid = 'saved-brew';
      stored.config.unix_timestamp = 1;
      this.entries.push(stored);
      return Promise.resolve(cloneBrew(stored));
    });

  public update = jasmine
    .createSpy('update')
    .and.callFake((brew: Brew): Promise<boolean> => {
      if (this.failUpdate) {
        return Promise.resolve(false);
      }
      const index = this.entries.findIndex(
        (entry) => entry.config.uuid === brew.config.uuid,
      );
      if (index >= 0) {
        this.entries[index] = cloneBrew(brew);
      }
      return Promise.resolve(index >= 0);
    });

  public getEntryByUUID(uuid: string): Brew {
    const stored = this.entries.find((entry) => entry.config.uuid === uuid);
    return stored ? cloneBrew(stored) : null;
  }

  public seed(brew: Brew): void {
    this.entries.push(cloneBrew(brew));
  }
}

describe('BrewImportService', () => {
  let service: BrewImportService;
  let beanStorage: jasmine.SpyObj<UIBeanStorage>;
  let millStorage: jasmine.SpyObj<UIMillStorage>;
  let preparationStorage: jasmine.SpyObj<UIPreparationStorage>;
  let settingsStorage: jasmine.SpyObj<UISettingsStorage>;
  let brewStorage: MemoryBrewStorage;
  let fileHelper: jasmine.SpyObj<UIFileHelper>;
  let settings: Settings;

  beforeEach(() => {
    beanStorage = jasmine.createSpyObj('UIBeanStorage', [
      'getAllEntries',
      'getByUUID',
      'add',
    ]);
    millStorage = jasmine.createSpyObj('UIMillStorage', [
      'getAllEntries',
      'add',
    ]);
    preparationStorage = jasmine.createSpyObj('UIPreparationStorage', [
      'getAllEntries',
      'getByUUID',
      'add',
    ]);
    settingsStorage = jasmine.createSpyObj('UISettingsStorage', [
      'getSettings',
    ]);
    brewStorage = new MemoryBrewStorage();
    fileHelper = jasmine.createSpyObj('UIFileHelper', [
      'writeInternalFileFromText',
    ]);
    fileHelper.writeInternalFileFromText.and.resolveTo();

    const beans = [entry(new Bean(), 'Any coffee', 'bean-1')];
    const mills = [entry(new Mill(), 'Any grinder', 'mill-1')];
    const preparations = [
      entry(new Preparation(), 'Any brewer', 'preparation-1'),
    ];

    beanStorage.getAllEntries.and.returnValue(beans);
    beanStorage.getByUUID.and.callFake((uuid: string) =>
      beans.find((bean) => bean.config.uuid === uuid),
    );
    millStorage.getAllEntries.and.returnValue(mills);
    preparationStorage.getAllEntries.and.returnValue(preparations);
    preparationStorage.getByUUID.and.callFake((uuid: string) =>
      preparations.find((preparation) => preparation.config.uuid === uuid),
    );

    settings = new Settings();
    settings.graph_colors.customTrace.active.light = '#123456';
    settings.graph_colors.customTrace.active.dark = '#abcdef';
    settingsStorage.getSettings.and.returnValue(settings);

    (UIBeanStorage as any).instance = beanStorage;
    UIPreparationStorage.instance = preparationStorage;
    BrewInstanceHelper.setEntryAmountBackToZero();

    const translate = jasmine.createSpyObj('TranslateService', ['instant']);
    translate.instant.and.callFake((key: string) => {
      if (key === 'BREW_IMPORT_METRIC_TARGET') {
        return 'Target';
      }
      if (key === 'BREW_IMPORT_METRIC_MEASURED') {
        return 'Measured';
      }
      return key;
    });

    TestBed.configureTestingModule({
      providers: [
        BrewImportService,
        { provide: UIBeanStorage, useValue: beanStorage },
        { provide: UIMillStorage, useValue: millStorage },
        { provide: UIPreparationStorage, useValue: preparationStorage },
        { provide: UIBrewStorage, useValue: brewStorage },
        { provide: UIFileHelper, useValue: fileHelper },
        { provide: UISettingsStorage, useValue: settingsStorage },
        { provide: TranslateService, useValue: translate },
      ],
    });

    service = TestBed.inject(BrewImportService);
  });

  afterEach(() => {
    (UIBeanStorage as any).instance = undefined;
    UIPreparationStorage.instance = undefined;
    BrewInstanceHelper.setEntryAmountBackToZero();
  });

  it('maps a full envelope onto brew fields and pins quantity types to host enum keys', () => {
    const result = service.build(envelope());

    expect(result.brew.grind_weight).toBe(18);
    expect(result.brew.brew_quantity).toBe(300);
    expect(result.brew.brew_quantity_type).toBe('ML');
    expect(result.brew.brew_beverage_quantity).toBe(240);
    expect(result.brew.brew_beverage_quantity_type).toBe('GR');
    expect(result.brew.brew_time).toBe(210);
    expect(result.brew.brew_time_milliseconds).toBe(250);
    expect(result.brew.brew_temperature).toBe(93);
    expect(result.brew.grind_size).toBe('7.2');
    expect(result.brew.mill_speed).toBe(60);
    expect(result.brew.coffee_first_drip_time).toBe(12);
    expect(result.brew.coffee_first_drip_time_milliseconds).toBe(500);
    expect(result.brew.coffee_blooming_time).toBe(35);
    expect(result.brew.note).toBe('A completed brew');
    expect(result.brew.config.unix_timestamp).toBe(1789907696);
  });

  it('splits fractional bloom and first-drip times into seconds and milliseconds', () => {
    const result = service.build(
      envelope({
        brew: {
          ...envelope().brew,
          bloomTime: 35.75,
          firstDripTime: 12.125,
        },
      }),
    );

    expect(result.brew.coffee_blooming_time).toBe(35);
    expect(result.brew.coffee_blooming_time_milliseconds).toBe(750);
    expect(result.brew.coffee_first_drip_time).toBe(12);
    expect(result.brew.coffee_first_drip_time_milliseconds).toBe(125);
  });

  it('reconstructs flow samples from deltas and converts decigrams to grams', () => {
    const result = service.build(envelope());

    expect(result.brewFlow.weight.map((sample) => sample.timestamp)).toEqual([
      '00:00:00.000',
      '00:00:01.000',
      '00:00:01.250',
    ]);
    expect(
      result.brewFlow.weight.map((sample) => sample.actual_weight),
    ).toEqual([0, 5, 12.5]);
    expect(result.brewFlow.weight.map((sample) => sample.old_weight)).toEqual([
      0, 0, 5,
    ]);
    expect(
      result.brewFlow.weight.map((sample) => sample.actual_smoothed_weight),
    ).toEqual([0, 5, 12.5]);
    expect(
      result.brewFlow.weight.map((sample) => sample.not_mutated_weight),
    ).toEqual([0, 5, 12.5]);
    expect(
      result.brewFlow.waterDispensed.map((sample) => sample.actual),
    ).toEqual([0, 12.5, 15]);
    expect(result.brewFlow.waterDispensed.map((sample) => sample.old)).toEqual([
      0, 0, 12.5,
    ]);
    expect(
      result.brewFlow.temperatureFlow.map(
        (sample) => sample.actual_temperature,
      ),
    ).toEqual([91, 92, 93]);
    expect(
      result.brewFlow.temperatureFlow.map((sample) => sample.old_temperature),
    ).toEqual([0, 91, 92]);
  });

  it('accepts a single flow sample', () => {
    const result = service.build(
      envelope({
        flow: {
          fidelity: 'downsampled',
          t: [125],
          waterDispensed: [34],
          weight: [12],
        },
      }),
    );

    expect(result.brewFlow.weight).toEqual([
      jasmine.objectContaining({
        timestamp: '00:00:00.125',
        actual_weight: 1.2,
        old_weight: 0,
      }),
    ]);
    expect(result.brewFlow.waterDispensed).toEqual([
      jasmine.objectContaining({ actual: 3.4, old: 0 }),
    ]);
  });

  it('accepts an empty flow array without inventing samples', () => {
    const result = service.build(
      envelope({
        flow: {
          fidelity: 'full',
          t: [],
          waterDispensed: [],
          weight: [],
        },
        metrics: undefined,
      }),
    );

    expect(result.brewFlow.weight).toEqual([]);
    expect(result.brewFlow.waterDispensed).toEqual([]);
    expect(result.brewFlow.temperatureFlow).toEqual([]);
    expect(result.brewFlow.customMetrics).toEqual({});
  });

  it('maps metrics to custom metric series and axes with translated prefixes deferred to render time', () => {
    const result = service.build(envelope());

    expect(Object.keys(result.brewFlow.customMetrics)).toContain(
      'targetTemperature',
    );
    expect(result.brewFlow.customMetrics.targetTemperature).toEqual([
      { value: 93, timestamp: '00:00:00.000', brew_time: '0.000' },
      { value: 91, timestamp: '00:00:45.000', brew_time: '45.000' },
    ]);
    expect(
      result.brewFlow.customAxes.find(
        (axis) => axis.key === 'targetTemperature',
      ),
    ).toEqual(
      jasmine.objectContaining({
        key: 'targetTemperature',
        namePrefix: 'BREW_IMPORT_METRIC_TARGET',
        name: 'Temperature',
        unit: '°C',
        colorLight: '#123456',
        colorDark: '#abcdef',
      }),
    );
  });

  it('keeps target and measured metric claims distinguishable in axis metadata', () => {
    const result = service.build(envelope());

    const target = result.brewFlow.customAxes.find(
      (axis) => axis.key === 'targetTemperature',
    );
    const measured = result.brewFlow.customAxes.find(
      (axis) => axis.key === 'measuredAgitation',
    );

    expect(target.namePrefix).toBe('BREW_IMPORT_METRIC_TARGET');
    expect(target.name).toBe('Temperature');
    expect(measured.namePrefix).toBe('BREW_IMPORT_METRIC_MEASURED');
    expect(measured.name).toBe('Agitation');
  });

  it('links a bean whose name matches an existing entry without duplicating it', () => {
    const result = service.build(envelope());

    expect(result.brew.bean).toBe('bean-1');
    expect(beanStorage.add.calls.count()).toBe(0);
  });

  it('falls back to the first active bean for a missing bean and does not create one', () => {
    const beans = [
      entry(new Bean(), 'Zed coffee', 'bean-z'),
      entry(new Bean(), 'Alpha coffee', 'bean-a'),
    ];
    beanStorage.getAllEntries.and.returnValue(beans);
    beanStorage.getByUUID.and.callFake((uuid: string) =>
      beans.find((bean) => bean.config.uuid === uuid),
    );

    const result = service.build(
      envelope({ bean: { name: 'Unknown coffee' } }),
    );

    expect(result.brew.bean).toBe('bean-a');
    expect(result.brew.note).toBe(
      'A completed brew\n\nBean not linked: "Unknown coffee" (no match). Using "Alpha coffee".',
    );
    expect(beanStorage.add.calls.count()).toBe(0);
  });

  it('ignores a non-string bean name from an opaque decoded bean and falls back safely', () => {
    const result = service.build(envelope({ bean: { name: 42 } }));

    expect(result.brew.bean).toBe('bean-1');
    expect(result.brew.note).toContain(
      'Bean not linked: no name supplied (missing name). Using "Any coffee".',
    );
    expect(beanStorage.add.calls.count()).toBe(0);
  });

  it('normalizes composed and decomposed characters when matching names', () => {
    beanStorage.getAllEntries.and.returnValue([
      entry(new Bean(), 'Café Juno', 'bean-cafe'),
    ]);

    const result = service.build(
      envelope({ bean: { name: 'Cafe\u0301 Juno' } }),
    );

    expect(result.brew.bean).toBe('bean-cafe');
    expect(result.brew.note).toBe('A completed brew');
  });

  it('leaves a missing mill unset, records the hint in the note, and does not create one', () => {
    millStorage.getAllEntries.and.returnValue([]);

    const result = service.build(envelope());

    expect(result.brew.mill).toBe('');
    expect(result.brew.note).toContain('Any grinder');
    expect(result.brew.note).toContain('Grinder not linked');
    expect(millStorage.add.calls.count()).toBe(0);
  });

  it('falls back to the first active preparation for a missing preparation and does not create one', () => {
    const preparations = [
      entry(new Preparation(), 'V60', 'preparation-v60'),
      entry(new Preparation(), 'Aeropress', 'preparation-aero'),
    ];
    preparationStorage.getAllEntries.and.returnValue(preparations);
    preparationStorage.getByUUID.and.callFake((uuid: string) =>
      preparations.find((preparation) => preparation.config.uuid === uuid),
    );

    const result = service.build(envelope());

    expect(result.brew.method_of_preparation).toBe('preparation-aero');
    expect(result.brew.note).toContain(
      'Preparation not linked: "Any brewer" (no match). Using "Aeropress".',
    );
    expect(preparationStorage.add.calls.count()).toBe(0);
  });

  it('does not persist an unmatched imported brew with empty bean or preparation UUIDs', () => {
    beanStorage.getAllEntries.and.returnValue([
      entry(new Bean(), 'Fallback bean', 'bean-fallback'),
    ]);
    preparationStorage.getAllEntries.and.returnValue([
      entry(new Preparation(), 'Fallback brewer', 'preparation-fallback'),
    ]);

    const result = service.build(
      envelope({
        bean: { name: 'Unknown coffee' },
        brew: { ...envelope().brew, preparationMethod: 'Unknown brewer' },
      }),
    );

    expect(result.brew.bean).toBe('bean-fallback');
    expect(result.brew.method_of_preparation).toBe('preparation-fallback');
  });

  it('loads an unmatched imported brew through host accessors without throwing', () => {
    const beans = [entry(new Bean(), 'Fallback bean', 'bean-fallback')];
    const preparations = [
      entry(new Preparation(), 'Fallback brewer', 'preparation-fallback'),
    ];
    beanStorage.getAllEntries.and.returnValue(beans);
    beanStorage.getByUUID.and.callFake((uuid: string) =>
      beans.find((bean) => bean.config.uuid === uuid),
    );
    preparationStorage.getAllEntries.and.returnValue(preparations);
    preparationStorage.getByUUID.and.callFake((uuid: string) =>
      preparations.find((preparation) => preparation.config.uuid === uuid),
    );

    const brew = service.build(
      envelope({
        bean: { name: 'Unknown coffee' },
        brew: { ...envelope().brew, preparationMethod: 'Unknown brewer' },
      }),
    ).brew;

    expect(() => brew.getBean()).not.toThrow();
    expect(() => brew.getPreparation()).not.toThrow();
    expect(brew.getBean().config.uuid).toBe('bean-fallback');
    expect(brew.getPreparation().config.uuid).toBe('preparation-fallback');
  });

  it('does not guess when a bean name match is ambiguous', () => {
    beanStorage.getAllEntries.and.returnValue([
      entry(new Bean(), ' Any Coffee ', 'bean-1'),
      entry(new Bean(), 'any coffee', 'bean-2'),
      entry(new Bean(), 'Fallback coffee', 'bean-fallback'),
    ]);

    const result = service.build(envelope());

    expect(result.brew.bean).toBe('bean-1');
    expect(result.brew.note).toContain('Bean not linked');
    expect(result.brew.note).toContain('multiple matches');
    expect(result.brew.note).toContain('Using " Any Coffee "');
  });

  it('imports a complete brew without a flow trace', () => {
    const result = service.build(envelope({ flow: undefined }));

    expect(result.brew.brew_quantity).toBe(300);
    expect(result.brewFlow.customMetrics.targetTemperature.length).toBe(2);
    expect(result.brewFlow.weight).toEqual([]);
  });

  it('does not create empty axes when metrics are absent', () => {
    const result = service.build(envelope({ metrics: undefined }));

    expect(result.brewFlow.customAxes).toEqual([]);
    expect(result.brewFlow.customMetrics).toEqual({});
  });

  it('keeps an empty note empty when no match hints are appended', () => {
    const result = service.build(
      envelope({ brew: { ...envelope().brew, note: '' } }),
    );

    expect(result.brew.note).toBe('');
  });

  it('persists imported provenance, timestamp, and flow path through save and load', async () => {
    const result = await service.import(envelope());

    const loaded = brewStorage.getEntryByUUID(result.brew.config.uuid);

    expect(loaded.config.unix_timestamp).toBe(1789907696);
    expect(loaded.flow_profile).toBe('brews/saved-brew_flow_profile.json');
    expect(loaded.customInformation.imported).toEqual(envelope().imported);
    expect(fileHelper.writeInternalFileFromText.calls.allArgs()).toEqual([
      [jasmine.any(String), 'brews/saved-brew_flow_profile.json'],
    ]);
  });

  it('does not write or assign a flow profile when neither flow nor metrics contain content', async () => {
    const result = await service.import(
      envelope({ flow: undefined, metrics: undefined }),
    );

    const loaded = brewStorage.getEntryByUUID(result.brew.config.uuid);

    expect(result.brew.flow_profile).toBe('');
    expect(loaded.flow_profile).toBe('');
    expect(fileHelper.writeInternalFileFromText.calls.count()).toBe(0);
  });

  it('skips the flow profile and still imports figures when writing flow content fails', async () => {
    fileHelper.writeInternalFileFromText.and.rejectWith(new Error('disk full'));

    const result = await service.import(envelope());

    const loaded = brewStorage.getEntryByUUID(result.brew.config.uuid);
    expect(result.brew.flow_profile).toBe('');
    expect(loaded.flow_profile).toBe('');
    expect(loaded.config.unix_timestamp).toBe(1789907696);
    expect(loaded.customInformation.imported).toEqual(envelope().imported);
  });

  it('rejects when the post-add update fails', async () => {
    brewStorage.failUpdate = true;

    await expectAsync(service.import(envelope())).toBeRejectedWithError(
      'Imported brew update failed: saved-brew',
    );
  });

  it('rejects without persisting when no bean or preparation fallback exists', async () => {
    beanStorage.getAllEntries.and.returnValue([]);
    preparationStorage.getAllEntries.and.returnValue([]);

    await expectAsync(service.import(envelope())).toBeRejectedWithError(
      'Bean not linked: no available Bean.',
    );

    expect(brewStorage.add.calls.count()).toBe(0);
    expect(brewStorage.update.calls.count()).toBe(0);
    expect(fileHelper.writeInternalFileFromText.calls.count()).toBe(0);
  });

  it('loads existing brews without imported provenance from storage', () => {
    const legacy = new Brew();
    legacy.config.uuid = 'legacy-brew';
    legacy.customInformation = { visualizer_id: '' };
    brewStorage.seed(legacy);

    const loaded = brewStorage.getEntryByUUID('legacy-brew');

    expect(loaded.customInformation.imported).toBeUndefined();
  });

  it('handles a decoder-produced null-prototype bean object', async () => {
    const decoded = await decodeHandoffPayload(
      await encodeEnvelopeForDecoder(envelope()),
    );

    expect(Object.getPrototypeOf(decoded.bean)).toBeNull();

    const result = service.build(decoded);

    expect(result.brew.bean).toBe('bean-1');
  });
});
