import { openReferencePicker, type PickerOption, type PickerPosition, type ReferencePicker } from "./reference-picker";

/** Each action retains its typed record or scenario origin until the user selects it. */
export interface FindRecord extends PickerOption {
  inspect(): Promise<boolean>;
}

export function openAtlasFind(
  records: readonly FindRecord[],
  returnFocus: HTMLElement,
  isCurrent: () => boolean,
  inspected: (position: PickerPosition) => void,
  onClose: () => void,
  initialPosition?: PickerPosition,
): ReferencePicker {
  return openReferencePicker({
    title: "Find anything",
    label: "records",
    options: () => records,
    emptyMessage: "No records in this dataset.",
    returnFocus,
    ...(initialPosition ? { initialPosition } : {}),
    onClose,
    isCurrent,
    onSelect: (value, position) => {
      const record = records.find((item) => item.value === value);
      // Closing the picker restores its opener. Let the normal navigation guard capture that
      // focus before asking about a draft, or focusing the accepted destination.
      if (record)
        queueMicrotask(() => {
          if (isCurrent())
            void record.inspect().then((accepted) => {
              if (accepted) inspected(position);
            });
        });
    },
  });
}
