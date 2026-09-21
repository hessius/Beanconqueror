import { TestBed } from '@angular/core/testing';

import { Platform } from '@ionic/angular/standalone';

import { TranslateService } from '@ngx-translate/core';

import { Settings } from '../../../classes/settings/settings';
import { PREPARATION_STYLE_TYPE } from '../../../enums/preparations/preparationStyleTypes';
import { CoffeeBluetoothDevicesService } from '../../coffeeBluetoothDevices/coffee-bluetooth-devices.service';
import { ThemeService } from '../../theme/theme.service';
import { UISettingsStorage } from '../../uiSettingsStorage';
import { GraphHelperService } from '../graph-helper.service';

describe('GraphHelperService axis fitting', () => {
  let service: GraphHelperService;

  beforeEach(() => {
    service = buildService();
  });

  it('lets the water axis grow past the default to hold the whole pour', () => {
    const traces = filledTraces(service);
    traces.waterDispensedTrace.y = [0, 120, 260, 312];

    const layout = layoutFor(service, traces, true);

    expect(layout['yaxis6'].range[0]).toBe(0);
    expect(layout['yaxis6'].range[1]).toBeGreaterThanOrEqual(312);
  });

  it('keeps the default water axis when a brew stays well inside it', () => {
    const traces = filledTraces(service);
    traces.waterDispensedTrace.y = [0, 12, 40];

    const layout = layoutFor(service, traces, true);

    expect(layout['yaxis6'].range).toEqual([0, 100]);
  });

  it('keeps the default water axis when nothing was dispensed', () => {
    const traces = filledTraces(service);

    const layout = layoutFor(service, traces, true);

    expect(layout['yaxis6'].range).toEqual([0, 100]);
  });

  it('fits a custom axis around its own values rather than around zero', () => {
    const traces = filledTraces(service);
    traces.customTraces = {
      targetTemperature: customTrace([88, 93, 90]),
    };

    const layout = layoutFor(service, traces, true);
    const range = layout['yaxis11'].range;

    expect(range[0]).toBeGreaterThan(80);
    expect(range[0]).toBeLessThan(88);
    expect(range[1]).toBeGreaterThan(93);
  });

  it('gives a flat custom series a visible band instead of a zero-height axis', () => {
    const traces = filledTraces(service);
    traces.customTraces = {
      targetTemperature: customTrace([93, 93, 93]),
    };

    const layout = layoutFor(service, traces, true);

    expect(layout['yaxis11'].range).toEqual([92, 94]);
  });

  it('falls back to the fixed custom range when the series is empty', () => {
    const traces = filledTraces(service);
    traces.customTraces = {
      targetTemperature: customTrace([]),
    };

    const layout = layoutFor(service, traces, true);

    expect(layout['yaxis11'].range).toEqual([0, 20]);
  });

  it('keeps the default water axis for a pour that just reaches it', () => {
    // The headroom must not apply below the default, or an ordinary brew
    // peaking in the high nineties would silently redraw on [0, 101].
    const traces = filledTraces(service);
    traces.waterDispensedTrace.y = [0, 60, 98];

    const layout = layoutFor(service, traces, true);

    expect(layout['yaxis6'].range).toEqual([0, 100]);
  });

  it('keeps the water axis finite when a sample is not a number', () => {
    const traces = filledTraces(service);
    traces.waterDispensedTrace.y = [0, NaN, 260];

    const layout = layoutFor(service, traces, true);

    expect(Number.isFinite(layout['yaxis6'].range[1])).toBe(true);
    expect(layout['yaxis6'].range[1]).toBeGreaterThanOrEqual(260);
  });

  it('falls back to the fixed custom range when the series is missing', () => {
    const traces = filledTraces(service);
    const trace: any = customTrace([]);
    trace.y = undefined;
    traces.customTraces = { targetTemperature: trace };

    const layout = layoutFor(service, traces, true);

    expect(layout['yaxis11'].range).toEqual([0, 20]);
  });

  it('fits the water axis on the small card too', () => {
    const traces = filledTraces(service);
    traces.waterDispensedTrace.y = [0, 260];

    const layout = layoutFor(service, traces, false);

    expect(layout['yaxis6'].range[1]).toBeGreaterThanOrEqual(260);
  });
});
function filledTraces(service: GraphHelperService) {
  const traces = service.initializeTraces();
  return service.fillTraces(traces, graphSettings(), true);
}

function customTrace(values: number[]) {
  return {
    x: values.map((_value, index) => index),
    y: values,
    yaxis: 'y11',
    line: { color: '#000000' },
    visible: true,
  };
}

function layoutFor(
  service: GraphHelperService,
  traces: any,
  isDetail: boolean,
) {
  return service.getChartLayout(
    traces,
    PREPARATION_STYLE_TYPE.FULL_IMMERSION,
    false,
    false,
    isDetail,
    300,
    150,
    true,
  );
}

function buildService(): GraphHelperService {
  const translate = jasmine.createSpyObj('TranslateService', ['instant']);
  translate.instant.and.callFake((key: string | undefined) => String(key));

  TestBed.configureTestingModule({
    providers: [
      GraphHelperService,
      {
        provide: TranslateService,
        useValue: translate,
      },
      {
        provide: UISettingsStorage,
        useValue: jasmine.createSpyObj('UISettingsStorage', {
          getSettings: new Settings(),
        }),
      },
      {
        provide: CoffeeBluetoothDevicesService,
        useValue: jasmine.createSpyObj('CoffeeBluetoothDevicesService', [
          'getScaleDelay',
          'getScale',
          'getPressureDevice',
          'getTemperatureDevice',
        ]),
      },
      {
        provide: Platform,
        useValue: jasmine.createSpyObj('Platform', ['is']),
      },
      {
        provide: ThemeService,
        useValue: jasmine.createSpyObj('ThemeService', {
          isDarkMode: false,
        }),
      },
    ],
  });

  return TestBed.inject(GraphHelperService);
}

function graphSettings() {
  return {
    weight: true,
    calc_flow: true,
    realtime_flow: true,
    pressure: true,
    temperature: true,
    weightSecond: true,
    realtime_flowSecond: true,
  };
}
