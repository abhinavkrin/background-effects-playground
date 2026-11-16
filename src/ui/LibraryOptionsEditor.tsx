import type { LibraryOptions } from '../engines/types';

interface LibraryOptionsEditorProps {
	value: LibraryOptions;
	onChange: (value: LibraryOptions) => void;
}

/** The BackgroundProcessor options from livekit/track-processors-js#159 and its follow-ups, each with what it does. */
export const LibraryOptionsEditor = ({ value, onChange }: LibraryOptionsEditorProps) => (
	<div className='options'>
		<label className='option'>
			<span className='option-head'>
				<code>segmentationMask</code>
				<select aria-label='segmentationMask' value={value.segmentationMask} onChange={(event) => onChange({ ...value, segmentationMask: event.target.value as LibraryOptions['segmentationMask'] })}>
					<option value='category'>'category'</option>
					<option value='confidence'>'confidence'</option>
				</select>
			</span>
			<span className='option-sub'>
				Category mask: the per-pixel class decision, 0 or 1. Confidence mask: the per-pixel probability, 0 to 1, so the edge moves by fractions of a
				pixel and multiclass models work.
			</span>
		</label>
		<label className='option'>
			<span className='option-head'>
				<input type='checkbox' checked={value.temporalSmoothing} onChange={(event) => onChange({ ...value, temporalSmoothing: event.target.checked })} />
				<code>temporalSmoothing</code>
			</span>
			<span className='option-sub'>Motion-adaptive EMA of the mask: keeps 15% of the new mask where the frame is still, up to 90% where it moves.</span>
		</label>
		<label className='option'>
			<span className='option-head'>
				<input type='checkbox' checked={value.edgeRefinement} onChange={(event) => onChange({ ...value, edgeRefinement: event.target.checked })} />
				<code>edgeRefinement</code>
			</span>
			<span className='option-sub'>Joint bilateral filter guided by the frame: each mask pixel takes the mask of nearby pixels of similar colour, so the edge snaps to the outline.</span>
		</label>
	</div>
);
