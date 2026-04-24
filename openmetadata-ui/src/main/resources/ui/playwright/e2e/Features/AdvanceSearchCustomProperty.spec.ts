/*
 *  Copyright 2026 Collate.
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *  http://www.apache.org/licenses/LICENSE-2.0
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
import test, { expect } from '@playwright/test';
import { CUSTOM_PROPERTIES_ENTITIES } from '../../constant/customProperty';
import { CP_RANGE_VALUES } from '../../constant/customPropertyAdvancedSearch';
import { GlobalSettingOptions } from '../../constant/settings';
import { SidebarItem } from '../../constant/sidebar';
import { EntityTypeEndpoint } from '../../support/entity/Entity.interface';
import { TableClass } from '../../support/entity/TableClass';
import {
  CONDITIONS_MUST,
  selectOption,
  showAdvancedSearchDialog,
} from '../../utils/advancedSearch';
import { advanceSearchSaveFilter } from '../../utils/advancedSearchCustomProperty';
import { createNewPage, redirectToHomePage, uuid } from '../../utils/common';
import {
  addCustomPropertiesForEntity,
  setValueForProperty,
} from '../../utils/customProperty';
import {
  applyCustomPropertyFilter,
  clearAdvancedSearchFilters,
} from '../../utils/customPropertyAdvancedSearchUtils';
import { settingClick, sidebarClick } from '../../utils/sidebar';

// use the admin user to login
test.use({ storageState: 'playwright/.auth/admin.json' });

test.describe('Advanced Search Custom Property', () => {
  const table = new TableClass();
  const durationPropertyName = `pwCustomPropertyDurationTest${uuid()}`;
  const durationPropertyValue = 'PT1H30M';

  test.beforeAll('Setup pre-requests', async ({ browser }) => {
    const { apiContext, afterAction } = await createNewPage(browser);
    await table.create(apiContext);
    await afterAction();
  });

  test.afterAll('Cleanup', async ({ browser }) => {
    const { apiContext, afterAction } = await createNewPage(browser);
    await table.delete(apiContext);
    await afterAction();
  });

  test('Create, Assign and Test Advanced Search for Duration', async ({
    page,
  }) => {
    test.slow(true);

    await redirectToHomePage(page);

    await test.step('Create and Assign Custom Property Value', async () => {
      await settingClick(page, GlobalSettingOptions.TABLES, true);

      await addCustomPropertiesForEntity({
        page,
        propertyName: durationPropertyName,
        customPropertyData: CUSTOM_PROPERTIES_ENTITIES['entity_table'],
        customType: 'Duration',
      });

      await table.visitEntityPage(page);

      const customPropertyResponse = page.waitForResponse(
        '/api/v1/metadata/types/name/table?fields=customProperties'
      );
      await page.getByTestId('custom_properties').click(); // Tab Click

      await customPropertyResponse;

      await page.locator('.ant-skeleton-active').first().waitFor({
        state: 'detached',
      });

      await page
        .getByTestId(`custom-property-${durationPropertyName}-card`)
        .getByTestId('edit-icon')
        .click(); // Add Custom Property Value

      await page.getByTestId('duration-input').fill(durationPropertyValue);

      const saveResponse = page.waitForResponse('/api/v1/tables/*');
      await page.getByTestId('inline-save-btn').click();
      await saveResponse;
    });

    await test.step('Verify Duration Type in Advance Search ', async () => {
      await sidebarClick(page, SidebarItem.EXPLORE);

      await showAdvancedSearchDialog(page);

      const ruleLocator = page.locator('.rule').nth(0);

      // Perform click on rule field
      await selectOption(
        page,
        ruleLocator.locator('.rule--field .ant-select'),
        'Custom Properties',
        true
      );

      await selectOption(
        page,
        ruleLocator.locator('.rule--field .ant-select'),
        'Table',
        true
      );

      // Perform click on custom property type to filter
      await selectOption(
        page,
        ruleLocator.locator('.rule--field .ant-select'),
        durationPropertyName,
        true
      );

      // Perform click on operator
      await selectOption(
        page,
        ruleLocator.locator('.rule--operator .ant-select'),
        CONDITIONS_MUST.equalTo.name
      );

      const inputElement = ruleLocator.locator(
        '.rule--widget--TEXT input[type="text"]'
      );

      await inputElement.fill(durationPropertyValue);

      await advanceSearchSaveFilter(page, durationPropertyValue);

      await expect(
        page.getByTestId(
          `table-data-card_${table.entityResponseData.fullyQualifiedName}`
        )
      ).toBeVisible();

      // Check around the Partial Search Value
      const partialSearchValue = durationPropertyValue.slice(0, 3);

      await page.getByTestId('advance-search-filter-btn').click();

      await expect(page.locator('[role="dialog"].ant-modal')).toBeVisible();

      // Perform click on operator
      await selectOption(
        page,
        ruleLocator.locator('.rule--operator .ant-select'),
        'Contains'
      );

      await inputElement.fill(partialSearchValue);

      await advanceSearchSaveFilter(page, partialSearchValue);

      await expect(
        page.getByTestId(
          `table-data-card_${table.entityResponseData.fullyQualifiedName}`
        )
      ).toBeVisible();
    });
  });
});

/**
 * Regression test for Issue #27482.
 *
 * Before the fix, `buildEsRule` passed only `value[0]` to `buildExtensionQuery`
 * for extension fields, silently dropping the upper bound of a `between` range.
 * This caused the filter to return every entity that had the property set
 * (behaving like an exists-check) rather than filtering by the actual range.
 *
 * This test proves the fix end-to-end by:
 *   1. Creating a `number` type custom property on Table entities.
 *   2. Assigning a known value (55.7) to the test table via PATCH.
 *   3. Applying `between 50 and 60` and asserting the search API payload
 *      contains `"gte":50` and `"lte":60`.
 *   4. Applying `not_between 1 and 5` and asserting the payload contains
 *      `"must_not"` wrapping the same range structure.
 *   5. Applying `between 100 and 200` (value 55.7 is outside) and asserting
 *      the entity is NOT visible in the results.
 */
test.describe('Advanced Search – number custom property between operator (Issue #27482)', () => {
  const table = new TableClass();
  const numberPropertyName = `pwNumberBetweenTest${uuid()}`;
  // CP_RANGE_VALUES.number = { start: 50, end: 60 }
  // CP_BASE_VALUES.number  = 55.7  → falls inside [50, 60]
  const assignedValue = 55.7;

  test.beforeAll('Setup: create table', async ({ browser }) => {
    const { apiContext, afterAction } = await createNewPage(browser);
    await table.create(apiContext);
    await afterAction();
  });

  // #27482 – upper bound was dropped before fix
  test('between operator sends gte/lte bounds in the ES query_filter', async ({
    page,
  }) => {
    test.slow(true);

    await redirectToHomePage(page);

    await test.step('Create number custom property and assign value', async () => {
      await settingClick(page, GlobalSettingOptions.TABLES, true);

      await addCustomPropertiesForEntity({
        page,
        propertyName: numberPropertyName,
        customPropertyData: CUSTOM_PROPERTIES_ENTITIES['entity_table'],
        customType: 'Number',
      });

      await table.visitEntityPage(page);

      const customPropertyResponse = page.waitForResponse(
        '/api/v1/metadata/types/name/table?fields=customProperties'
      );
      await page.getByTestId('custom_properties').click();
      await customPropertyResponse;

      await page.locator('.ant-skeleton-active').first().waitFor({
        state: 'detached',
      });

      await setValueForProperty({
        page,
        propertyName: numberPropertyName,
        value: String(assignedValue),
        propertyType: 'number',
        endpoint: EntityTypeEndpoint.Table,
      });
    });

    await test.step('between [50, 60]: query_filter must contain gte:50 and lte:60', async () => {
      await sidebarClick(page, SidebarItem.EXPLORE);
      await showAdvancedSearchDialog(page);

      await applyCustomPropertyFilter(
        page,
        numberPropertyName,
        'between',
        CP_RANGE_VALUES.number, // { start: 50, end: 60 }
        'Table'
      );

      // Intercept the search request and assert both bounds are present
      const searchResponse = page.waitForResponse(
        '/api/v1/search/query?*index=dataAsset*'
      );
      await page.getByTestId('apply-btn').click();
      const res = await searchResponse;

      const url = res.request().url();
      const params = new URLSearchParams(url.split('?')[1]);
      const queryFilter = JSON.parse(params.get('query_filter') ?? '{}');
      const queryFilterStr = JSON.stringify(queryFilter);

      // Core regression assertion: both bounds must survive to the request
      expect(queryFilterStr).toContain('"gte":50');
      expect(queryFilterStr).toContain('"lte":60');

      await clearAdvancedSearchFilters(page);
    });

    await test.step('not_between [1, 5]: query_filter must contain must_not with gte:1 and lte:5', async () => {
      await sidebarClick(page, SidebarItem.EXPLORE);
      await showAdvancedSearchDialog(page);

      await applyCustomPropertyFilter(
        page,
        numberPropertyName,
        'not_between',
        { start: 1, end: 5 },
        'Table'
      );

      const searchResponse = page.waitForResponse(
        '/api/v1/search/query?*index=dataAsset*'
      );
      await page.getByTestId('apply-btn').click();
      const res = await searchResponse;

      const url = res.request().url();
      const params = new URLSearchParams(url.split('?')[1]);
      const queryFilter = JSON.parse(params.get('query_filter') ?? '{}');
      const queryFilterStr = JSON.stringify(queryFilter);

      expect(queryFilterStr).toContain('"must_not"');
      expect(queryFilterStr).toContain('"gte":1');
      expect(queryFilterStr).toContain('"lte":5');

      await clearAdvancedSearchFilters(page);
    });

    await test.step('between [100, 200]: entity with value 55.7 should NOT be visible in results', async () => {
      await sidebarClick(page, SidebarItem.EXPLORE);
      await showAdvancedSearchDialog(page);

      await applyCustomPropertyFilter(
        page,
        numberPropertyName,
        'between',
        { start: 100, end: 200 },
        'Table'
      );

      const searchResponse = page.waitForResponse(
        '/api/v1/search/query?*index=dataAsset*'
      );
      await page.getByTestId('apply-btn').click();
      await searchResponse;

      await expect(
        page.getByTestId(
          `table-data-card_${table.entityResponseData.fullyQualifiedName}`
        )
      ).not.toBeVisible();

      await clearAdvancedSearchFilters(page);
    });
  });
});
