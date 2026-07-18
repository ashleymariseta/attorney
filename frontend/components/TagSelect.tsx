'use client';

import { Select } from 'antd';

/**
 * Searchable, multi-value select that also accepts free-typed entries
 * (antd "tags" mode). Used for practice areas and jurisdictions, which are
 * free-form string lists on the lawyer profile.
 */
export default function TagSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <Select
      mode="tags"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      options={options.map((o) => ({ label: o, value: o }))}
      tokenSeparators={[',']}
      style={{ width: '100%' }}
      size="large"
      maxTagCount="responsive"
    />
  );
}
