import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_theme.dart';

/// Asset paths for the bundled undraw illustrations.
class Illustrations {
  static const judge = 'assets/img/undraw_judge_hyqv.svg';
  static const contract = 'assets/img/undraw_contract_ynau.svg';
}

/// Recolours undraw illustrations onto the Attorney teal palette. undraw art
/// uses a single accent (#6c63ff) plus a dark figure/robe tone (#3f3d56) and a
/// pale accent fill (#e3e8f4); we remap those to brand hues so the art reads
/// on-brand while leaving neutrals (greys, skin tones) untouched.
class _BrandColorMapper extends ColorMapper {
  const _BrandColorMapper();

  @override
  Color substitute(String? id, String elementName, String attributeName, Color color) {
    switch (color.toARGB32() & 0xFFFFFF) {
      case 0x6C63FF: // undraw signature accent
        return AppColors.brand;
      case 0x3F3D56: // dark figure / robe
        return AppColors.brandDark;
      case 0xE3E8F4: // pale accent fill
        return AppColors.brandLight;
      default:
        return color;
    }
  }
}

/// An undraw illustration recoloured to the brand palette.
class BrandIllustration extends StatelessWidget {
  const BrandIllustration(this.asset, {super.key, this.height, this.semanticLabel});

  final String asset;
  final double? height;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      asset,
      height: height,
      fit: BoxFit.contain,
      colorMapper: const _BrandColorMapper(),
      semanticsLabel: semanticLabel,
    );
  }
}
