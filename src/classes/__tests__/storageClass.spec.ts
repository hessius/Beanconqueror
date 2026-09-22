import { TestBed } from '@angular/core/testing';

import { StorageClass } from '../storageClass';
import { UIAlert } from '../../services/uiAlert';
import { UILog } from '../../services/uiLog';
import { UIStorage } from '../../services/uiStorage';
import { createMockUIAlert, createMockUILog } from '../../test-utils';

class TestStorage extends StorageClass {
  public constructor() {
    super('TEST_DB');
  }

  public setEntries(entries: any[]): void {
    this.storedData = entries;
  }
}

describe('StorageClass', () => {
  let storage: TestStorage;
  let mockUIStorage: jasmine.SpyObj<UIStorage>;
  let mockUILog: jasmine.SpyObj<any> & {
    logs: string[];
    errors: string[];
    debugLogs: string[];
  };
  let mockUIAlert: jasmine.SpyObj<any>;

  const entry = (uuid?: string) => ({
    config: uuid ? { uuid } : {},
    name: 'Test entry',
  });

  beforeEach(() => {
    mockUIStorage = jasmine.createSpyObj<UIStorage>('UIStorage', [
      'get',
      'set',
    ]);
    mockUILog = createMockUILog();
    mockUIAlert = createMockUIAlert();
    mockUIAlert.showMessage.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        { provide: UIStorage, useValue: mockUIStorage },
        { provide: UILog, useValue: mockUILog },
      ],
    });

    spyOn(UIAlert, 'getInstance').and.returnValue(mockUIAlert);
    storage = TestBed.runInInjectionContext(() => new TestStorage());
  });

  it('reports successful saves from addAndConfirm, update, and removeByUUID', async () => {
    mockUIStorage.set.and.returnValue(Promise.resolve(true));

    const addResult = await storage.addAndConfirm(entry());
    const uuid = addResult.entry.config.uuid;
    const updateResult = await storage.update({
      ...addResult.entry,
      name: 'Updated entry',
    });
    const removeResult = await storage.removeByUUID(uuid);

    expect(addResult.saved).toBeTrue();
    expect(updateResult).toBeTrue();
    expect(removeResult).toBeTrue();
    expect(mockUIAlert.showMessage).not.toHaveBeenCalled();
  });

  it('reports failed saves when uiStorage.set resolves something other than true', async () => {
    mockUIStorage.set.and.returnValue(Promise.resolve('not-saved' as any));

    const addResult = await storage.addAndConfirm(entry());
    storage.setEntries([entry('update-uuid')]);
    const updateResult = await storage.update(entry('update-uuid'));
    storage.setEntries([entry('delete-uuid')]);
    const removeResult = await storage.removeByUUID('delete-uuid');

    expect(addResult.saved).toBeFalse();
    expect(updateResult).toBeFalse();
    expect(removeResult).toBeFalse();
    expect(mockUIAlert.showMessage).toHaveBeenCalledTimes(3);
    expect(mockUIAlert.showMessage).toHaveBeenCalledWith(
      'Storage - Save Set - Unsuccessfully  - "not-saved"',
      'CRITICAL ERROR',
    );
    expect(mockUILog.errors).toContain(
      'Storage - Update  - Unsucessfully - update-uuid - save failed',
    );
  });

  it('reports failed saves when uiStorage.set rejects', async () => {
    mockUIStorage.set.and.returnValue(Promise.reject(new Error('set failed')));

    const addResult = await storage.addAndConfirm(entry());
    storage.setEntries([entry('update-uuid')]);
    const updateResult = await storage.update(entry('update-uuid'));
    storage.setEntries([entry('delete-uuid')]);
    const removeResult = await storage.removeByUUID('delete-uuid');

    expect(addResult.saved).toBeFalse();
    expect(updateResult).toBeFalse();
    expect(removeResult).toBeFalse();
    expect(mockUIAlert.showMessage).toHaveBeenCalledTimes(3);
    expect(mockUIAlert.showMessage).toHaveBeenCalledWith(
      '{}',
      'CRITICAL ERROR - SAVE SET',
    );
    expect(mockUILog.errors).toContain(
      'Storage - Update  - Unsucessfully - update-uuid - save failed',
    );
  });

  it('reports failed saves when uiStorage.set throws synchronously', async () => {
    mockUIStorage.set.and.callFake(() => {
      throw new Error('set threw');
    });

    const addResult = await storage.addAndConfirm(entry());
    storage.setEntries([entry('update-uuid')]);
    const updateResult = await storage.update(entry('update-uuid'));
    storage.setEntries([entry('delete-uuid')]);
    const removeResult = await storage.removeByUUID('delete-uuid');

    expect(addResult.saved).toBeFalse();
    expect(updateResult).toBeFalse();
    expect(removeResult).toBeFalse();
    expect(mockUIAlert.showMessage).toHaveBeenCalledTimes(3);
    expect(mockUIAlert.showMessage).toHaveBeenCalledWith(
      'set threw',
      'CRITICAL ERROR',
    );
    expect(mockUILog.errors).toContain(
      'Storage - Update  - Unsucessfully - update-uuid - save failed',
    );
  });

  it('keeps update not-found failures distinguishable from save failures', async () => {
    mockUIStorage.set.and.returnValue(Promise.resolve(true));
    storage.setEntries([entry('stored-uuid')]);

    const updateResult = await storage.update(entry('missing-uuid'));

    expect(updateResult).toBeFalse();
    expect(mockUIStorage.set).not.toHaveBeenCalled();
    expect(mockUILog.errors).toContain(
      'Storage - Update  - Unsucessfully - missing-uuid - not found',
    );
    expect(mockUILog.errors).not.toContain(
      'Storage - Update  - Unsucessfully - missing-uuid - save failed',
    );
  });

  it('keeps add returning a cloned entry with a uuid when the save fails', async () => {
    mockUIStorage.set.and.returnValue(Promise.resolve(false));
    const newEntry = entry();

    const result = await storage.add(newEntry);

    expect(result).not.toBe(newEntry);
    expect(result.config.uuid).toEqual(jasmine.any(String));
    expect(storage.getAllEntries()[0].config.uuid).toBe(result.config.uuid);
    expect(mockUIAlert.showMessage).toHaveBeenCalledWith(
      'Storage - Save Set - Unsuccessfully  - false',
      'CRITICAL ERROR',
    );
  });
});
