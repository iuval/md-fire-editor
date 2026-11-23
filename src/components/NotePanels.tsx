import { useState } from 'react'
import { ChevronRight, Plus, X } from 'lucide-react'
import { plural, useT } from '../i18n/index.ts'
import {
  propertyTypeLabel,
  PROPERTY_TYPES,
  formatPropertyValue,
  type Property,
  type PropertyType,
} from '../lib/properties'

export interface PropertyChange {
  key: string
  type?: PropertyType
  value: string | string[] | boolean | number | null
}

interface NotePanelsProps {
  tags: string[]
  properties: Property[]
  editable: boolean
  onTagClick?: (tag: string) => void
  onRenameTag?: () => void
  onPropertyChange: (change: PropertyChange) => void
}

/**
 * Tags and typed labels under the note title.
 *
 * Both start collapsed: the document is the screen, and frontmatter is metadata
 * you look at on demand (same default as Obsidian's collapsed properties).
 */
export function NotePanels({
  tags,
  properties,
  editable,
  onTagClick,
  onRenameTag,
  onPropertyChange,
}: NotePanelsProps) {
  const t = useT()
  const [tagsOpen, setTagsOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newType, setNewType] = useState<PropertyType>('text')
  const [newValue, setNewValue] = useState('')

  const addProperty = () => {
    const key = newKey.trim()
    if (!key) return
    onPropertyChange({ key, type: newType, value: newValue })
    setNewKey('')
    setNewValue('')
    setNewType('text')
  }

  return (
    <>
      <div className="panel-row">
        <button
          className="panel-toggle"
          onClick={() => setTagsOpen((v) => !v)}
          aria-expanded={tagsOpen}
        >
          <ChevronRight size={11} className={`chev${tagsOpen ? ' open' : ''}`} />
          {plural(tags.length, { one: t('note.tagOne', { count: tags.length }), other: t('note.tagOther', { count: tags.length }) })}
        </button>
        {tagsOpen &&
          tags.map((tag) => (
            <button key={tag} className="tag-chip" onClick={() => onTagClick?.(tag)}>
              #{tag}
            </button>
          ))}
        {tagsOpen && tags.length > 0 && onRenameTag && (
          <button className="panel-toggle" onClick={onRenameTag}>
            renombrar…
          </button>
        )}
      </div>

      <div className="panel-row">
        <button
          className="panel-toggle"
          onClick={() => setPropsOpen((v) => !v)}
          aria-expanded={propsOpen}
        >
          <ChevronRight size={11} className={`chev${propsOpen ? ' open' : ''}`} />
          {plural(properties.length, { one: t('note.propertyOne', { count: properties.length }), other: t('note.propertyOther', { count: properties.length }) })}
        </button>
      </div>

      {propsOpen && (
        <div className="prop-list">
          {properties.map((property) => (
            <div className="prop-row" key={property.key}>
              <span className="prop-key" title={property.key}>
                {property.key}
              </span>

              {editable ? (
                <>
                  {property.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(property.value)}
                      aria-label={t('property.valueOf', { key: property.key })}
                      onChange={(e) =>
                        onPropertyChange({ key: property.key, value: e.target.checked })
                      }
                    />
                  ) : (
                    <input
                      className="prop-input"
                      type={property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : 'text'}
                      value={
                        property.type === 'list'
                          ? formatPropertyValue(property)
                          : String(property.value)
                      }
                      aria-label={t('property.valueOf', { key: property.key })}
                      onChange={(e) =>
                        onPropertyChange({
                          key: property.key,
                          type: property.type,
                          value: e.target.value,
                        })
                      }
                    />
                  )}

                  <select
                    className="prop-type"
                    value={property.type}
                    aria-label={t('property.typeOf', { key: property.key })}
                    onChange={(e) =>
                      onPropertyChange({
                        key: property.key,
                        type: e.target.value as PropertyType,
                        value: property.value as string,
                      })
                    }
                  >
                    {PROPERTY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {propertyTypeLabel(type)}
                      </option>
                    ))}
                  </select>

                  <button
                    className="icon-btn icon-btn--sm"
                    aria-label={t('property.remove', { key: property.key })}
                    onClick={() => onPropertyChange({ key: property.key, value: null })}
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <span className="prop-input" style={{ border: 'none', background: 'none' }}>
                  {formatPropertyValue(property)}
                </span>
              )}
            </div>
          ))}

          {editable && (
            <div className="prop-add">
              <input
                className="prop-input"
                placeholder={t('property.namePlaceholder')}
                aria-label={t('property.nameLabel')}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                style={{ maxWidth: 120 }}
              />
              <select
                className="prop-type"
                value={newType}
                aria-label={t('property.typeLabel')}
                onChange={(e) => setNewType(e.target.value as PropertyType)}
              >
                {PROPERTY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {propertyTypeLabel(type)}
                  </option>
                ))}
              </select>
              <input
                className="prop-input"
                placeholder={t('property.valuePlaceholder')}
                aria-label={t('property.valueLabel')}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
              <button
                className="icon-btn icon-btn--sm"
                aria-label={t('property.addLabel')}
                onClick={addProperty}
                disabled={!newKey.trim()}
              >
                <Plus size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
