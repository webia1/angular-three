import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	computed,
	CUSTOM_ELEMENTS_SCHEMA,
	ElementRef,
	input,
	untracked,
	viewChild,
} from '@angular/core';
import {
	applyProps,
	extend,
	getLocalState,
	injectBeforeRender,
	injectStore,
	NgtArgs,
	NgtMeshStandardMaterial,
	omit,
	pick,
} from 'angular-three';
import { BlurPass, MeshReflectorMaterial } from 'angular-three-soba/shaders';
import { injectAutoEffect } from 'ngxtension/auto-effect';
import { mergeInputs } from 'ngxtension/inject-inputs';
import {
	DepthFormat,
	DepthTexture,
	HalfFloatType,
	LinearFilter,
	Matrix4,
	PerspectiveCamera,
	Plane,
	Texture,
	UnsignedShortType,
	Vector3,
	Vector4,
	WebGLRenderTarget,
} from 'three';

export interface NgtsMeshReflectorMaterialOptions extends Partial<NgtMeshStandardMaterial> {
	resolution: number;
	mixBlur: number;
	mixStrength: number;
	blur: [number, number] | number;
	mirror: number;
	minDepthThreshold: number;
	maxDepthThreshold: number;
	depthScale: number;
	depthToBlurRatioBias: number;
	distortion: number;
	mixContrast: number;
	reflectorOffset: number;
	distortionMap?: Texture;
}

const defaultOptions: NgtsMeshReflectorMaterialOptions = {
	mixBlur: 0,
	mixStrength: 1,
	resolution: 256,
	blur: [0, 0],
	minDepthThreshold: 0.9,
	maxDepthThreshold: 1,
	depthScale: 0,
	depthToBlurRatioBias: 0.25,
	mirror: 0,
	distortion: 1,
	mixContrast: 1,
	reflectorOffset: 0,
};

@Component({
	selector: 'ngts-mesh-reflector-material',
	standalone: true,
	template: `
		<ngt-primitive #material *args="[material()]" attach="material">
			<ng-content />
		</ngt-primitive>
	`,
	schemas: [CUSTOM_ELEMENTS_SCHEMA],
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [NgtArgs],
})
export class NgtsMeshReflectorMaterial {
	options = input(defaultOptions, { transform: mergeInputs(defaultOptions) });
	private parameters = omit(this.options, [
		'distortionMap',
		'resolution',
		'mixBlur',
		'mixStrength',
		'blur',
		'minDepthThreshold',
		'maxDepthThreshold',
		'depthScale',
		'depthToBlurRatioBias',
		'mirror',
		'distortion',
		'mixContrast',
		'reflectorOffset',
	]);

	private store = injectStore();
	private gl = this.store.select('gl');

	private materialRef = viewChild<ElementRef<MeshReflectorMaterial>>('material');

	private reflectOptions = pick(this.options, [
		'distortionMap',
		'resolution',
		'mixBlur',
		'mixStrength',
		'blur',
		'minDepthThreshold',
		'maxDepthThreshold',
		'depthScale',
		'depthToBlurRatioBias',
		'mirror',
		'distortion',
		'mixContrast',
		'reflectorOffset',
	]);

	private blur = pick(this.reflectOptions, 'blur');
	private resolution = pick(this.reflectOptions, 'resolution');
	private minDepthThreshold = pick(this.reflectOptions, 'minDepthThreshold');
	private maxDepthThreshold = pick(this.reflectOptions, 'maxDepthThreshold');
	private depthScale = pick(this.reflectOptions, 'depthScale');
	private depthToBlurRatioBias = pick(this.reflectOptions, 'depthToBlurRatioBias');

	private normalizedBlur = computed(() => {
		const blur = this.blur();
		return Array.isArray(blur) ? blur : [blur, blur];
	});
	private hasBlur = computed(() => this.normalizedBlur()[0] + this.normalizedBlur()[1] > 0);

	private reflectorPlane = new Plane();
	private normal = new Vector3();
	private reflectorWorldPosition = new Vector3();
	private cameraWorldPosition = new Vector3();
	private rotationMatrix = new Matrix4();
	private lookAtPosition = new Vector3(0, 0, -1);
	private clipPlane = new Vector4();
	private view = new Vector3();
	private target = new Vector3();
	private q = new Vector4();
	private textureMatrix = new Matrix4();
	private virtualCamera = new PerspectiveCamera();

	private renderTargetParameters = { minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType };

	private fbos = computed(() => {
		const resolution = this.resolution();
		const fbo1 = new WebGLRenderTarget(resolution, resolution, this.renderTargetParameters);
		fbo1.depthBuffer = true;
		fbo1.depthTexture = new DepthTexture(resolution, resolution);
		fbo1.depthTexture.format = DepthFormat;
		fbo1.depthTexture.type = UnsignedShortType;
		const fbo2 = new WebGLRenderTarget(resolution, resolution, this.renderTargetParameters);

		return { fbo1, fbo2 };
	});

	private blurPass = computed(() => {
		const [gl, resolution, blur, minDepthThreshold, maxDepthThreshold, depthScale, depthToBlurRatioBias] = [
			this.gl(),
			this.resolution(),
			this.normalizedBlur(),
			this.minDepthThreshold(),
			this.maxDepthThreshold(),
			this.depthScale(),
			this.depthToBlurRatioBias(),
		];
		return new BlurPass({
			gl,
			resolution,
			width: blur[0],
			height: blur[1],
			minDepthThreshold,
			maxDepthThreshold,
			depthScale,
			depthToBlurRatioBias,
		});
	});

	private reflectorParameters = computed(() => {
		const [
			{ fbo1, fbo2 },
			{
				mirror,
				mixBlur,
				mixStrength,
				minDepthThreshold,
				maxDepthThreshold,
				depthScale,
				depthToBlurRatioBias,
				distortion,
				distortionMap,
				mixContrast,
			},
			hasBlur,
		] = [this.fbos(), this.reflectOptions(), this.hasBlur()];
		return {
			mirror,
			textureMatrix: this.textureMatrix,
			mixBlur,
			tDiffuse: fbo1.texture,
			tDepth: fbo1.depthTexture,
			tDiffuseBlur: fbo2.texture,
			hasBlur,
			mixStrength,
			minDepthThreshold,
			maxDepthThreshold,
			depthScale,
			depthToBlurRatioBias,
			distortion,
			distortionMap,
			mixContrast,
			defines: {
				USE_BLUR: hasBlur ? '' : undefined,
				USE_DEPTH: depthScale > 0 ? '' : undefined,
				USE_DISTORTION: distortionMap ? '' : undefined,
			},
		};
	});

	private definesKey = computed(() => {
		const defines = this.reflectorParameters().defines;
		return Object.entries(defines).reduce((acc, [key, value]) => (value ? `${acc} ${key}` : acc), '');
	});

	material = computed(() => {
		// tracking defines key so that the material is recreated when the defines change
		this.definesKey();
		return new MeshReflectorMaterial();
	});

	constructor() {
		extend({ MeshReflectorMaterial });

		const autoEffect = injectAutoEffect();

		afterNextRender(() => {
			autoEffect(() => {
				const material = this.materialRef()?.nativeElement;
				if (!material) return;
				applyProps(material, this.reflectorParameters());
			});

			autoEffect(() => {
				const material = this.materialRef()?.nativeElement;
				if (!material) return;
				applyProps(material, this.parameters());
			});
		});

		injectBeforeRender(({ gl, scene }) => {
			const material = this.materialRef()?.nativeElement;
			if (!material) return;

			const localState = getLocalState(material);
			if (!localState) return;

			const parent = Reflect.get(material, 'parent') ?? untracked(localState.parent);
			if (!parent) return;

			const { fbo1, fbo2 } = untracked(this.fbos);
			const hasBlur = untracked(this.hasBlur);
			const blurPass = untracked(this.blurPass);

			parent.visible = false;
			const currentXrEnabled = gl.xr.enabled;
			const currentShadowAutoUpdate = gl.shadowMap.autoUpdate;
			this.beforeRender();
			gl.xr.enabled = false;
			gl.shadowMap.autoUpdate = false;
			gl.setRenderTarget(fbo1);
			gl.state.buffers.depth.setMask(true);
			if (!gl.autoClear) gl.clear();
			gl.render(scene, this.virtualCamera);
			if (hasBlur) blurPass.render(gl, fbo1, fbo2);
			gl.xr.enabled = currentXrEnabled;
			gl.shadowMap.autoUpdate = currentShadowAutoUpdate;
			parent.visible = true;
			gl.setRenderTarget(null);
		});
	}

	private beforeRender() {
		const material = this.materialRef()?.nativeElement;
		if (!material) return;

		const localState = getLocalState(material);
		if (!localState) return;

		const parent = Reflect.get(material, 'parent') ?? untracked(localState.parent);
		if (!parent) return;

		const { camera } = this.store.snapshot;
		const { reflectorOffset } = untracked(this.options);

		this.reflectorWorldPosition.setFromMatrixPosition(parent.matrixWorld);
		this.cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
		this.rotationMatrix.extractRotation(parent.matrixWorld);
		this.normal.set(0, 0, 1);
		this.normal.applyMatrix4(this.rotationMatrix);
		this.reflectorWorldPosition.addScaledVector(this.normal, reflectorOffset);
		this.view.subVectors(this.reflectorWorldPosition, this.cameraWorldPosition);
		// Avoid rendering when reflector is facing away
		if (this.view.dot(this.normal) > 0) return;
		this.view.reflect(this.normal).negate();
		this.view.add(this.reflectorWorldPosition);
		this.rotationMatrix.extractRotation(camera.matrixWorld);
		this.lookAtPosition.set(0, 0, -1);
		this.lookAtPosition.applyMatrix4(this.rotationMatrix);
		this.lookAtPosition.add(this.cameraWorldPosition);
		this.target.subVectors(this.reflectorWorldPosition, this.lookAtPosition);
		this.target.reflect(this.normal).negate();
		this.target.add(this.reflectorWorldPosition);
		this.virtualCamera.position.copy(this.view);
		this.virtualCamera.up.set(0, 1, 0);
		this.virtualCamera.up.applyMatrix4(this.rotationMatrix);
		this.virtualCamera.up.reflect(this.normal);
		this.virtualCamera.lookAt(this.target);
		this.virtualCamera.far = camera.far; // Used in WebGLBackground
		this.virtualCamera.updateMatrixWorld();
		this.virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
		// Update the texture matrix
		this.textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
		this.textureMatrix.multiply(this.virtualCamera.projectionMatrix);
		this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse);
		this.textureMatrix.multiply(parent.matrixWorld);
		// Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
		// Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
		this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorWorldPosition);
		this.reflectorPlane.applyMatrix4(this.virtualCamera.matrixWorldInverse);
		this.clipPlane.set(
			this.reflectorPlane.normal.x,
			this.reflectorPlane.normal.y,
			this.reflectorPlane.normal.z,
			this.reflectorPlane.constant,
		);
		const projectionMatrix = this.virtualCamera.projectionMatrix;
		this.q.x = (Math.sign(this.clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
		this.q.y = (Math.sign(this.clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
		this.q.z = -1.0;
		this.q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
		// Calculate the scaled plane vector
		this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q));
		// Replacing the third row of the projection matrix
		projectionMatrix.elements[2] = this.clipPlane.x;
		projectionMatrix.elements[6] = this.clipPlane.y;
		projectionMatrix.elements[10] = this.clipPlane.z + 1.0;
		projectionMatrix.elements[14] = this.clipPlane.w;
	}
}
