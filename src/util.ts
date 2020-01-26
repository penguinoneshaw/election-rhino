export function additiveMerge<T extends string | number | symbol>(
    a: Record<T, number>,
    b: Record<T, number>,
): Record<T, number> {
    const output = { ...a };
    Object.entries(b).forEach(([k, v]) => {
        output[k] = v + (output[k] ? output[k] : 0);
    });

    return output;
}
