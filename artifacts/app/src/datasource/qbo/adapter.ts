import type { DataSource, DateRange, SourceDescriptor } from '@/datasource/types';

/**
 * STUB — live QuickBooks Online connector is story JPH-14, which is out of
 * scope for this build. The class exists so the ImportService, import pages
 * and settings can reference a `qbo` DataSource without special-casing; every
 * method throws until JPH-14 lands (OAuth 2.0, Query API paging, CDC sync).
 */
export class QboDataSource implements DataSource {
  readonly kind = 'qbo' as const;
  private notImplemented(): never {
    throw new Error('QuickBooks Online connector is not implemented (Jira JPH-14 not in scope)');
  }
  describe(): Promise<SourceDescriptor> {
    return this.notImplemented();
  }
  fetchAccounts(): never {
    return this.notImplemented();
  }
  fetchClasses(): never {
    return this.notImplemented();
  }
  fetchLocations(): never {
    return this.notImplemented();
  }
  fetchParties(): never {
    return this.notImplemented();
  }
  fetchTransactions(_range: DateRange): never {
    return this.notImplemented();
  }
}
